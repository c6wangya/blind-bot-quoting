-- THE-772 — Accessory "compatibility note" (free text + images) per accessory model.
-- Run in the Supabase SQL editor (quote project), AFTER 0001 (needs public.is_admin()).
-- Idempotent: safe to re-run.
--
-- A model gets at most ONE note: a free-text body plus any number of images. Admin edits it in a
-- popup next to the product's Add button; retailers see it (read-only) next to the same button when
-- a note exists. Purely for retailer-facing DISPLAY — does not affect pricing or orderability.
-- Independent of, and coexists with, the structured "Compatible variation" system (0041).

create table if not exists public.accessory_model_notes (
  model_id    text primary key references public.accessory_models(id) on delete cascade,
  body        text not null default '',
  updated_at  timestamptz not null default now()
);

-- Images belonging to a model's note (stored in the accessory-images bucket; path → public URL).
create table if not exists public.accessory_model_note_images (
  id          text primary key,
  model_id    text not null references public.accessory_models(id) on delete cascade,
  path        text not null,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists accessory_model_note_images_model_idx
  on public.accessory_model_note_images(model_id);

-- ---------- RLS: everyone reads (retailer display); only admins write ----------
alter table public.accessory_model_notes        enable row level security;
alter table public.accessory_model_note_images  enable row level security;

drop policy if exists accessory_model_notes_select on public.accessory_model_notes;
create policy accessory_model_notes_select on public.accessory_model_notes for select using (true);
drop policy if exists accessory_model_notes_write on public.accessory_model_notes;
create policy accessory_model_notes_write on public.accessory_model_notes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists accessory_model_note_images_select on public.accessory_model_note_images;
create policy accessory_model_note_images_select on public.accessory_model_note_images for select using (true);
drop policy if exists accessory_model_note_images_write on public.accessory_model_note_images;
create policy accessory_model_note_images_write on public.accessory_model_note_images
  for all using (public.is_admin()) with check (public.is_admin());
