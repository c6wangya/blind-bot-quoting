-- THE-772 — per-motor shipping mode (FOB vs US Ground), set by an admin on the Shipping tab.
-- Run in the Supabase SQL editor. Idempotent.
--
-- A motor's shipping mode follows where it's MADE: China-made → 'fob' (air/sea, no domestic freight),
-- US-made → 'ground' (domestic freight per unit at ship_ground/ship_expedite). A quote can mix both;
-- shipping is computed per line by each motor's mode. The customer can't change this — only an admin.
-- 'fob' is the default (most motors are China-made).

alter table public.accessory_models add column if not exists ship_mode text not null default 'fob';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accessory_models_ship_mode_chk') then
    alter table public.accessory_models
      add constraint accessory_models_ship_mode_chk check (ship_mode in ('fob', 'ground'));
  end if;
end $$;
