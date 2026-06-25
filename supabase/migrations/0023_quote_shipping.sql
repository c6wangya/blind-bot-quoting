-- THE-772 — per-quote shipping mode + per-retailer ground-shipping waiver.
-- Run in the Supabase SQL editor. Idempotent.
--
-- A quote ships either FOB (from China, air/sea — no domestic freight, the default & the legacy
-- behaviour) or US "ground" (domestic freight per motor; optionally expedited). The chosen mode +
-- expedite flag live on the quote. profiles.waive_shipping lets an admin mark a special retailer as
-- never charged ground shipping (expedite is a premium and is always charged regardless).

alter table public.quotes add column if not exists shipping_mode text    not null default 'fob';
alter table public.quotes add column if not exists expedite      boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_shipping_mode_chk') then
    alter table public.quotes
      add constraint quotes_shipping_mode_chk check (shipping_mode in ('fob', 'ground'));
  end if;
end $$;

alter table public.profiles add column if not exists waive_shipping boolean not null default false;

-- Orders snapshot the shipping charged at submit (like discount_pct) so a later rate change never
-- alters a placed order. orders.amount already includes this shipping.
alter table public.orders add column if not exists ship_mode     text    not null default 'fob';
alter table public.orders add column if not exists ship_expedite boolean not null default false;
alter table public.orders add column if not exists shipping      numeric(10,2) not null default 0;
