-- THE-772 — per-retailer address book (saved quote-header presets).
-- Run in the Supabase SQL editor. Idempotent.
--
-- Each row is a reusable snapshot of a quote's header fields (customer / ship-to / references) so a
-- retailer can fill the accessory checkout form by picking a saved address instead of retyping.
-- Owned per auth user; one row may be flagged is_default. Field set mirrors QuoteDetails.

create table if not exists public.profile_addresses (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  label         text,
  customer_name  text,
  customer_phone text,
  customer_email text,
  ship_address1 text,
  ship_address2 text,
  ship_city     text,
  ship_state    text,
  ship_zip      text,
  po            text,
  sidemark      text,
  project_name  text,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profile_addresses_owner_idx on public.profile_addresses(owner_id);

-- ---------- RLS: owner reads/writes own rows; admins (profiles.role='admin') all ----------
alter table public.profile_addresses enable row level security;

drop policy if exists profile_addresses_select on public.profile_addresses;
create policy profile_addresses_select on public.profile_addresses
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists profile_addresses_insert on public.profile_addresses;
create policy profile_addresses_insert on public.profile_addresses
  for insert with check (owner_id = auth.uid());

drop policy if exists profile_addresses_update on public.profile_addresses;
create policy profile_addresses_update on public.profile_addresses
  for update using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists profile_addresses_delete on public.profile_addresses;
create policy profile_addresses_delete on public.profile_addresses
  for delete using (owner_id = auth.uid() or public.is_admin());
