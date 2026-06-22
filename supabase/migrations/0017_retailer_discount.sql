-- THE-772 — per-retailer across-the-board order discount.
-- Run in the Supabase SQL editor. Idempotent.
--
-- profiles.order_discount_pct: a retailer's standing % off the order total (0–100).
-- orders.discount_pct: snapshot of that % at submit time, so changing a retailer's discount
-- later never alters historical orders. orders.amount already stores the (discounted) charge.

alter table public.profiles add column if not exists order_discount_pct numeric not null default 0;
alter table public.orders   add column if not exists discount_pct       numeric not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_discount_pct_chk') then
    alter table public.profiles add constraint profiles_discount_pct_chk check (order_discount_pct >= 0 and order_discount_pct <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_pct_chk') then
    alter table public.orders add constraint orders_discount_pct_chk check (discount_pct >= 0 and discount_pct <= 100);
  end if;
end $$;
