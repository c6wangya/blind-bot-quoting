-- Multiple emails for the primary customer (beyond the single customer_email).
-- `customer_emails` is a JSON array of extra addresses for the SAME customer — the primary
-- customer_email plus every entry here (plus every contact email) all receive the order
-- confirmation. On a quote it's what was entered at checkout; on an address it's the saved list.
-- Run once in the Supabase SQL editor. No RLS change: both tables already scope by owner.

alter table public.quotes
  add column if not exists customer_emails jsonb not null default '[]'::jsonb;

alter table public.profile_addresses
  add column if not exists customer_emails jsonb not null default '[]'::jsonb;
