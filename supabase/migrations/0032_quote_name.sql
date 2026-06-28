-- THE-772 — optional human-friendly quote name.
-- Run in the Supabase SQL editor. Idempotent.
--
-- A retailer can name a quote at creation time (the accessory "Create new quote" flow). When set,
-- lists prefer the name over the system ref (Q-YYYY-NNNN). NULL = unnamed (show the ref).

alter table public.quotes add column if not exists quote_name text;
