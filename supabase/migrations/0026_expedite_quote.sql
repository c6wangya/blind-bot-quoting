-- THE-772 — admin-priced expedited shipping ("custom expedite quote").
-- Run in the Supabase SQL editor (quote project). Idempotent: safe to re-run.
--
-- New flow (replaces the per-line auto-accumulation as the *charged* amount; the old accumulation in
-- lib/shipping.ts is kept only to suggest a reference price):
--   1. Retailer ticks "Request expedited shipping" on a draft quote  → expedite_status = 'requested',
--      and a special chat message (kind='expedite_request') lands in their support conversation
--      carrying a snapshot of the system reference fee.
--   2. Admin sets ONE flat total fee — inline on that message, or on the admin quote page →
--      expedite_status = 'quoted', expedite_fee = <amount>. The fee is sticky: later edits to the
--      quote do NOT clear it (the admin re-quotes only if they choose to).
--   3. The quote total (and the placed order's amount) include expedite_fee while status = 'quoted'.

alter table public.quotes add column if not exists expedite_status text not null default 'none';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_expedite_status_chk') then
    alter table public.quotes add constraint quotes_expedite_status_chk
      check (expedite_status in ('none', 'requested', 'quoted'));
  end if;
end $$;
alter table public.quotes add column if not exists expedite_fee numeric(10,2);

-- The request lands as a special chat message the admin can price inline.
--   expedite_ref_fee    — system reference (sum of per-line expedite rates) snapshot at request time
--   expedite_quoted_fee — the flat fee the admin entered from this card (null = still pending)
alter table public.messages add column if not exists kind text not null default 'chat';
alter table public.messages add column if not exists expedite_ref_fee    numeric(10,2);
alter table public.messages add column if not exists expedite_quoted_fee numeric(10,2);
