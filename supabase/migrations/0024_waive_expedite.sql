-- THE-772 — per-retailer EXPEDITE shipping waiver (in addition to the ground waiver from 0023).
-- Run in the Supabase SQL editor. Idempotent.
--
-- profiles.waive_shipping  → exempt from standard ground shipping (0023)
-- profiles.waive_expedite  → exempt from expedite shipping (this migration)
-- Business rule: expedite may only be waived once ground is waived (enforced in the app layer); a
-- retailer who pays ground can't be exempt from the expedite premium.

alter table public.profiles add column if not exists waive_expedite boolean not null default false;
