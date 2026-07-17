-- 0045 — Consolidate the "Default" accessory price onto a single source of truth.
--
-- The default price used to live in TWO places: accessory_models.default_price (the Catalog tab)
-- and shared "Default tier" rows in accessory_prices (retailer_id IS NULL, tier='default', the
-- Pricing → Default screen). They overlapped. The app now treats accessory_models.default_price as
-- the single source of truth for both screens, so the shared Default-tier rows are redundant.
--
-- Step 1: copy any shared Default-tier price back into accessory_models.default_price so nothing
--         changes in effect (that row was the intended default whenever it existed).
update accessory_models m
set default_price = p.price
from accessory_prices p
where p.model_id = m.id
  and p.retailer_id is null
  and p.tier = 'default';

-- Step 2: drop the now-redundant shared Default-tier rows. Per-retailer overrides
-- (retailer_id IS NOT NULL, tier='default') and all Business-tier rows are left untouched.
delete from accessory_prices
where retailer_id is null
  and tier = 'default';
