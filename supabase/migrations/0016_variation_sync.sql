-- THE-772 — link variations/items back to the catalog category/model they were synced from,
-- so "Sync to variation" is idempotent (re-run updates in place instead of duplicating).
-- Run in the Supabase SQL editor. Idempotent.

alter table public.variation_types add column if not exists source_category_id text;
alter table public.variation_items add column if not exists source_model_id text;

create index if not exists variation_types_source_cat_idx on public.variation_types(source_category_id);
create index if not exists variation_items_source_model_idx on public.variation_items(source_model_id);
