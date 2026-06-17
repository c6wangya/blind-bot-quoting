-- THE-772 — Accessory tag system (admin-managed faceted attributes for accessory models).
-- Run in the Supabase SQL editor (quote project), AFTER 0001 (needs public.is_admin()).
-- Idempotent: safe to re-run.
--
-- Model:
--   accessory_attributes        — a filter dimension, e.g. "Power" (multi=false) or
--                                 "Compatible products" (multi=true).
--   accessory_attribute_values  — a value within a dimension, e.g. "DC", "Drapery".
--   accessory_model_tags        — assigns a value to a static accessory model (by its id).
--
-- Tags are catalog metadata for retailer-facing FILTERING/DISPLAY only — they do not
-- affect pricing or orderability. Managed by admins via the Tags portal; readable by all.

create table if not exists public.accessory_attributes (
  id          text primary key,
  name        text not null,
  multi       boolean not null default false,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.accessory_attribute_values (
  id            text primary key,
  attribute_id  text not null references public.accessory_attributes(id) on delete cascade,
  label         text not null,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists accessory_attribute_values_attr_idx
  on public.accessory_attribute_values(attribute_id);

create table if not exists public.accessory_model_tags (
  model_id    text not null,
  value_id    text not null references public.accessory_attribute_values(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (model_id, value_id)
);
create index if not exists accessory_model_tags_model_idx
  on public.accessory_model_tags(model_id);

-- ---------- RLS: everyone reads (retailer filtering); only admins write ----------
alter table public.accessory_attributes        enable row level security;
alter table public.accessory_attribute_values  enable row level security;
alter table public.accessory_model_tags         enable row level security;

drop policy if exists accessory_attributes_select on public.accessory_attributes;
create policy accessory_attributes_select on public.accessory_attributes for select using (true);
drop policy if exists accessory_attributes_write on public.accessory_attributes;
create policy accessory_attributes_write on public.accessory_attributes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists accessory_attribute_values_select on public.accessory_attribute_values;
create policy accessory_attribute_values_select on public.accessory_attribute_values for select using (true);
drop policy if exists accessory_attribute_values_write on public.accessory_attribute_values;
create policy accessory_attribute_values_write on public.accessory_attribute_values
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists accessory_model_tags_select on public.accessory_model_tags;
create policy accessory_model_tags_select on public.accessory_model_tags for select using (true);
drop policy if exists accessory_model_tags_write on public.accessory_model_tags;
create policy accessory_model_tags_write on public.accessory_model_tags
  for all using (public.is_admin()) with check (public.is_admin());
