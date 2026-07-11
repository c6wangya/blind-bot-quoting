-- Personal business pricing: a per-retailer Business-tier price.
-- Run in the Supabase SQL editor (quote project), after 0040. Idempotent.
--
-- 0040 gave the SHARED (retailer_id NULL) rows a `tier` (default | business). This adds a
-- per-retailer Business-tier price so one authorized customer can have their own wholesale price
-- that beats the shared Business tier — while an explicit per-retailer override still wins on top.
-- No new column: a personal business price is just a per-retailer row with tier='business'
-- (per-retailer override rows keep tier='default'). The unique index must therefore include `tier`
-- so a retailer can hold BOTH a 'default'-tier override and a 'business'-tier personal price per
-- model (the old index was (model_id, retailer_id) and allowed only one row per retailer/model).
--
-- Resolution chain (see lib/db/motors.ts):
--   per-retailer override  ??  (if authorized: personal business ?? shared Business)  ??  Default
drop index if exists public.accessory_prices_retailer_uniq;
create unique index if not exists accessory_prices_retailer_uniq
  on public.accessory_prices(model_id, retailer_id, tier) where retailer_id is not null;
