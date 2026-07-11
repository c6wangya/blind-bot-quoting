-- THE-772 — Accessory compatibility ("Compatible variation") system.
-- Run in the Supabase SQL editor (quote project), AFTER 0001 (needs public.is_admin()).
-- Idempotent: safe to re-run.
--
-- A "compatible variation" is a named + imaged fitment entry attached to one accessory model.
-- Each entry checks any number of OTHER catalog models (referenced by id); on the retailer
-- accessory page they are grouped by their category (e.g. Crown → c1, c3, c10 / Drive → d1, d2)
-- and shown next to the part. A model can have several such entries (a., b., c. …).
--
-- Metadata for retailer-facing DISPLAY only — does not affect pricing or orderability.
--
-- NOTE: supersedes an earlier vocabulary-based design (dimensions/values). The drops below
-- clean that up if a prior 0041 was already run.

drop table if exists public.accessory_model_compat      cascade;
drop table if exists public.accessory_compat_values     cascade;
drop table if exists public.accessory_compat_dimensions cascade;

-- A named + imaged compatibility entry belonging to one accessory model.
create table if not exists public.accessory_model_compat_variations (
  id          text primary key,
  model_id    text not null references public.accessory_models(id) on delete cascade,
  name        text not null,
  image_url   text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists accessory_compat_variations_model_idx
  on public.accessory_model_compat_variations(model_id);

-- The catalog models checked inside a variation (referenced by id; grouped by category on display).
create table if not exists public.accessory_compat_variation_items (
  variation_id   text not null references public.accessory_model_compat_variations(id) on delete cascade,
  item_model_id  text not null references public.accessory_models(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (variation_id, item_model_id)
);
create index if not exists accessory_compat_variation_items_var_idx
  on public.accessory_compat_variation_items(variation_id);

-- ---------- RLS: everyone reads (retailer display); only admins write ----------
alter table public.accessory_model_compat_variations enable row level security;
alter table public.accessory_compat_variation_items  enable row level security;

drop policy if exists accessory_compat_variations_select on public.accessory_model_compat_variations;
create policy accessory_compat_variations_select on public.accessory_model_compat_variations for select using (true);
drop policy if exists accessory_compat_variations_write on public.accessory_model_compat_variations;
create policy accessory_compat_variations_write on public.accessory_model_compat_variations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists accessory_compat_variation_items_select on public.accessory_compat_variation_items;
create policy accessory_compat_variation_items_select on public.accessory_compat_variation_items for select using (true);
drop policy if exists accessory_compat_variation_items_write on public.accessory_compat_variation_items;
create policy accessory_compat_variation_items_write on public.accessory_compat_variation_items
  for all using (public.is_admin()) with check (public.is_admin());
