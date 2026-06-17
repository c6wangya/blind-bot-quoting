-- THE-772 — Richer quote header details (customer / ship-to / references).
-- Run in the Supabase SQL editor (quote project). Idempotent.
--
-- Inspired by the HD Brite create-quote flow (contact + project + references), folded into
-- fields on the quote itself — NOT a separate Contact/Project entity. `project_name` already
-- exists (reused as the project name). All nullable so existing/blank drafts are unaffected.

alter table public.quotes
  add column if not exists quote_type      text not null default 'product',
  add column if not exists customer_name   text,
  add column if not exists customer_phone  text,
  add column if not exists customer_email  text,
  add column if not exists ship_address1   text,
  add column if not exists ship_address2   text,
  add column if not exists ship_city       text,
  add column if not exists ship_state      text,
  add column if not exists ship_zip        text,
  add column if not exists po              text,
  add column if not exists sidemark        text;
