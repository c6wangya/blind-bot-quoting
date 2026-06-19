-- THE-772 — Retailer ↔ admin messaging (support chat).
-- Run in the Supabase SQL editor (quote project). Idempotent: safe to re-run.
--
-- Model: one persistent conversation per retailer (Intercom-style messenger, not tickets).
-- `last_*_read_at` timestamps drive the unread badges; the conversation row caches the last
-- message preview/sender so the admin inbox list and badges are cheap single-table reads.
-- RLS: retailer sees only their own conversation; admin (is_admin()) sees all.

create table if not exists public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  retailer_id           uuid not null unique references auth.users(id) on delete cascade,
  created_at            timestamptz not null default now(),
  last_message_at       timestamptz not null default now(),
  last_message_preview  text,
  last_sender_role      text check (last_sender_role in ('retailer', 'admin')),
  retailer_last_read_at timestamptz not null default now(),
  admin_last_read_at    timestamptz
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id),
  sender_role     text not null check (sender_role in ('retailer', 'admin')),
  body            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);
create index if not exists conversations_last_message_idx on public.conversations(last_message_at desc);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- =========================================================
-- conversations
-- =========================================================
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (retailer_id = auth.uid() or public.is_admin());

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert with check (retailer_id = auth.uid() or public.is_admin());

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update using (retailer_id = auth.uid() or public.is_admin())
  with check (retailer_id = auth.uid() or public.is_admin());

-- =========================================================
-- messages  (visibility/insert inherit the parent conversation)
-- =========================================================
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.retailer_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.retailer_id = auth.uid() or public.is_admin())
    )
  );
