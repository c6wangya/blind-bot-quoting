-- 0046 — Internal purchase/cost price per accessory model.
--
-- Admin-only. Never shown to customers and never part of the quote/effective-price chain — it exists
-- so the back office can track what a model costs to buy vs. what it sells for (margin). Lives on
-- accessory_models alongside default_price; a NULL value means "cost not recorded yet".
alter table accessory_models
  add column if not exists cost_price numeric;

alter table accessory_models
  add constraint accessory_models_cost_price_nonneg
  check (cost_price is null or cost_price >= 0);
