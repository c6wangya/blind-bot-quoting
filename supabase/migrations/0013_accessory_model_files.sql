-- THE-772 — per-model attachments (spec sheets, certifications, etc.) for accessory models.
-- Run in the Supabase SQL editor. Idempotent.
--
-- Files live in the public `accessory-images` bucket (product docs are public); only the path
-- is stored and the public URL is derived on read. Real FK → cascade, so deleting a model
-- removes its file rows automatically (deleteModel also clears the storage objects).

create table if not exists public.accessory_model_files (
  id          text primary key,
  model_id    text not null references public.accessory_models(id) on delete cascade,
  name        text not null,
  path        text not null,        -- storage path in the accessory-images bucket
  kind        text not null default 'other',  -- 'spec' | 'certification' | 'other'
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists accessory_model_files_model_idx on public.accessory_model_files(model_id);

alter table public.accessory_model_files enable row level security;

drop policy if exists accessory_model_files_select on public.accessory_model_files;
create policy accessory_model_files_select on public.accessory_model_files for select using (true);
drop policy if exists accessory_model_files_write on public.accessory_model_files;
create policy accessory_model_files_write on public.accessory_model_files
  for all using (public.is_admin()) with check (public.is_admin());
