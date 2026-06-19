-- THE-772 — Motor Crown + Driver options (admin-managed, priced).
-- Run in the Supabase SQL editor (quote project), after 0001 (needs public.is_admin()).
-- Idempotent.
--
-- When adding a motor to a quote the retailer chooses "Not needed" or a Crown + Driver
-- version. Each version is admin-managed and carries a price delta added to the motor's
-- unit price. The chosen versions are snapshotted onto the quote line.

create table if not exists public.motor_crown_options (
  id          text primary key,
  label       text not null,
  price_delta numeric not null default 0,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.motor_driver_options (
  id          text primary key,
  label       text not null,
  price_delta numeric not null default 0,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- RLS: everyone reads (the add-to-quote selector + prices); only admins write.
alter table public.motor_crown_options  enable row level security;
alter table public.motor_driver_options enable row level security;

drop policy if exists motor_crown_select on public.motor_crown_options;
create policy motor_crown_select on public.motor_crown_options for select using (true);
drop policy if exists motor_crown_write on public.motor_crown_options;
create policy motor_crown_write on public.motor_crown_options
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists motor_driver_select on public.motor_driver_options;
create policy motor_driver_select on public.motor_driver_options for select using (true);
drop policy if exists motor_driver_write on public.motor_driver_options;
create policy motor_driver_write on public.motor_driver_options
  for all using (public.is_admin()) with check (public.is_admin());
