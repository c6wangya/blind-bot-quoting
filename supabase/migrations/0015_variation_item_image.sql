-- THE-772 — optional image per variation item (e.g. Crown / Drive options).
-- Run in the Supabase SQL editor. Idempotent.
--
-- When an item has an image, the add-to-quote selector shows a visual card picker (with
-- click-to-zoom) instead of a text dropdown. Images live in the public accessory-images bucket.

alter table public.variation_items add column if not exists image_url text;
