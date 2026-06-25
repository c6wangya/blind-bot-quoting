-- THE-772 — per-motor shipping rates (US ground + expedite). Run in the Supabase SQL editor. Idempotent.
--
-- Shipping is charged per unit of a motor model when a quote ships US "ground" (vs FOB from China,
-- which carries no domestic freight). ship_ground / ship_expedite are USD per unit; they live on
-- accessory_models like default_price/moq, flow through loadCatalog, and are removed with the model
-- row (no deleteModel change needed). 0 = free (the default), e.g. crown/drive parts.

alter table public.accessory_models add column if not exists ship_ground   numeric(10,2) not null default 0;
alter table public.accessory_models add column if not exists ship_expedite numeric(10,2) not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accessory_models_ship_chk') then
    alter table public.accessory_models
      add constraint accessory_models_ship_chk check (ship_ground >= 0 and ship_expedite >= 0);
  end if;
end $$;
