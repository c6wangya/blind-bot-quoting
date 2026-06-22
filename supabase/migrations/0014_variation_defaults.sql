-- THE-772 — per-product default variation selection.
-- Run in the Supabase SQL editor. Idempotent.
--
-- Marks which assigned variation item is pre-selected for a product at add-to-quote time
-- (e.g. AM25 defaults to a specific Crown + Drive). At most one default per (model, variation)
-- is enforced in the admin UI; the DB just stores the flag.

alter table public.variation_product_items add column if not exists is_default boolean not null default false;
