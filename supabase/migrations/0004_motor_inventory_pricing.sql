-- THE-772 — Motor inventory + per-retailer motor pricing (admin-managed).
-- Run in the Supabase SQL editor (quote project), after 0001 (needs public.is_admin()).
-- Idempotent. Both apply to orderable A-OK motors only.

-- ---------- inventory ----------
-- One row per motor model. NO row = untracked (unlimited). Stock is deducted when a
-- pre-order is submitted; the catalog caps add-qty at the available stock.
create table if not exists public.accessory_inventory (
  model_id    text primary key,
  stock       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------- per-retailer pricing ----------
-- retailer_id NULL = the default price for that model; a non-null row overrides it for
-- that one retailer. Default seeds from the static catalog price on first edit.
create table if not exists public.accessory_prices (
  model_id     text not null,
  retailer_id  uuid references public.profiles(id) on delete cascade,  -- NULL = default
  price        numeric not null,
  updated_at   timestamptz not null default now()
);
-- one default row per model, and one override row per (model, retailer)
create unique index if not exists accessory_prices_default_uniq
  on public.accessory_prices(model_id) where retailer_id is null;
create unique index if not exists accessory_prices_retailer_uniq
  on public.accessory_prices(model_id, retailer_id) where retailer_id is not null;

-- ---------- RLS ----------
alter table public.accessory_inventory enable row level security;
alter table public.accessory_prices    enable row level security;

-- inventory: everyone reads (catalog "only X left"); only admins write.
drop policy if exists accessory_inventory_select on public.accessory_inventory;
create policy accessory_inventory_select on public.accessory_inventory for select using (true);
drop policy if exists accessory_inventory_write on public.accessory_inventory;
create policy accessory_inventory_write on public.accessory_inventory
  for all using (public.is_admin()) with check (public.is_admin());

-- prices: a retailer reads the default rows + their own; admins read all; only admins write.
drop policy if exists accessory_prices_select on public.accessory_prices;
create policy accessory_prices_select on public.accessory_prices
  for select using (retailer_id is null or retailer_id = auth.uid() or public.is_admin());
drop policy if exists accessory_prices_write on public.accessory_prices;
create policy accessory_prices_write on public.accessory_prices
  for all using (public.is_admin()) with check (public.is_admin());
