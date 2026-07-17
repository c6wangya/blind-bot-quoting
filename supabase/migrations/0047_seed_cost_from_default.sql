-- 0047 — Seed cost_price from default_price as a starting point.
--
-- cost_price (0046) starts NULL/0 for every model. Rather than typing each one in by hand, copy the
-- current default (selling) price across so the Cost column on the Pricing set screen has a sensible
-- baseline the admin can then adjust down to the real purchase cost. Only fills models that have no
-- cost recorded yet, so re-running is safe and never clobbers a cost that was already entered.
update accessory_models
set cost_price = default_price
where cost_price is null
  and default_price is not null;
