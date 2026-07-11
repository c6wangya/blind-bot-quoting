-- Business pricing: a second SHARED price tier + a per-retailer authorization flag.
-- Self-serving customers see the Default tier; sales flip profiles.business_pricing to put a
-- customer on the shared Business tier. Per-retailer overrides still win on top of either tier.

-- 1. A `tier` on the shared (retailer_id NULL) price rows. Existing rows are the Default tier;
--    business-tier rows are (retailer_id NULL, tier='business'). Per-retailer override rows keep
--    the default value and stay keyed by (model_id, retailer_id) regardless of tier.
alter table public.accessory_prices
  add column if not exists tier text not null default 'default';

do $$ begin
  alter table public.accessory_prices
    add constraint accessory_prices_tier_chk check (tier in ('default', 'business'));
exception when duplicate_object then null; end $$;

-- One shared row per (model, tier) among the retailer_id-NULL rows (was: one default per model).
drop index if exists public.accessory_prices_default_uniq;
create unique index if not exists accessory_prices_shared_uniq
  on public.accessory_prices(model_id, tier) where retailer_id is null;

-- 2. Per-retailer authorization: off (default) = Default pricing; on = the shared Business tier.
alter table public.profiles
  add column if not exists business_pricing boolean not null default false;
