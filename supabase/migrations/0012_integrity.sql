-- THE-772 — data-integrity hardening (review follow-up). Run in the Supabase SQL editor.
-- Idempotent: every constraint/index is guarded, and orphan rows are cleaned before FKs.
-- Safe to run on existing data (current rows already satisfy these).

-- ============================================================
-- 1. CHECK constraints on free-text status / payment / actor columns
-- ============================================================
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_status_chk') then
    alter table public.orders add constraint orders_status_chk
      check (status in ('awaiting_payment','submitted','acknowledged','in_production','shipped','in_transit','delivered','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_chk') then
    alter table public.orders add constraint orders_payment_status_chk
      check (payment_status in ('pending','paid','failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_chk') then
    alter table public.orders add constraint orders_payment_method_chk
      check (payment_method is null or payment_method in ('stripe','paypal','bank_transfer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_amount_chk') then
    alter table public.orders add constraint orders_amount_chk check (amount is null or amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_events_actor_chk') then
    alter table public.order_events add constraint order_events_actor_chk
      check (actor in ('retailer','supplier','logistics','system'));
  end if;
end $$;

-- ============================================================
-- 2. Money columns: non-negative
-- ============================================================
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accessory_prices_price_chk') then
    alter table public.accessory_prices add constraint accessory_prices_price_chk check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'variation_items_price_chk') then
    alter table public.variation_items add constraint variation_items_price_chk check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accessory_models_price_chk') then
    alter table public.accessory_models add constraint accessory_models_price_chk
      check (default_price is null or default_price >= 0);
  end if;
end $$;

-- ============================================================
-- 3. FKs for per-model config tables → accessory_models (clean orphans first)
-- ============================================================
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accessory_inventory_model_fk') then
    delete from public.accessory_inventory where model_id not in (select id from public.accessory_models);
    alter table public.accessory_inventory add constraint accessory_inventory_model_fk
      foreign key (model_id) references public.accessory_models(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accessory_prices_model_fk') then
    delete from public.accessory_prices where model_id not in (select id from public.accessory_models);
    alter table public.accessory_prices add constraint accessory_prices_model_fk
      foreign key (model_id) references public.accessory_models(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accessory_model_tags_model_fk') then
    delete from public.accessory_model_tags where model_id not in (select id from public.accessory_models);
    alter table public.accessory_model_tags add constraint accessory_model_tags_model_fk
      foreign key (model_id) references public.accessory_models(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'variation_product_items_model_fk') then
    delete from public.variation_product_items where model_id not in (select id from public.accessory_models);
    alter table public.variation_product_items add constraint variation_product_items_model_fk
      foreign key (model_id) references public.accessory_models(id) on delete cascade;
  end if;
end $$;

-- ============================================================
-- 4. Indexes for the hot lookups (ownership filters, references, joins)
-- ============================================================
create index if not exists quote_items_quote_idx   on public.quote_items(quote_id);
create index if not exists quote_items_product_idx  on public.quote_items(product_id);
create index if not exists orders_quote_idx         on public.orders(quote_id);
create index if not exists order_events_order_idx   on public.order_events(order_id);

-- ============================================================
-- 5. At most one active pricing version per line
-- ============================================================
create unique index if not exists pricing_versions_active_unique on public.pricing_versions(line_id) where active;

-- ============================================================
-- 6. Tighten app_settings read: only the bank-transfer key, only signed-in users
-- ============================================================
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (key = 'bank_transfer' and auth.uid() is not null);
