-- THE-772 — flag accessory-only orders. Run in the Supabase SQL editor.
-- Accessory-only orders use a collapsed 3-step fulfilment flow (payment auto-acknowledges, then
-- the supplier ships with admin-entered tracking numbers). Orders containing any product line keep
-- the full 6-step pipeline. Existing rows default to false (= product flow). Idempotent.
alter table public.orders add column if not exists accessory_only boolean not null default false;
