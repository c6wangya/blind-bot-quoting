-- Multiple notification recipients per order + reusable contacts per saved address.
-- `contacts` is a JSON array of { name, email } — the *additional* recipients beyond the primary
-- customerEmail. On a quote it's the set chosen at checkout; on an address it's the saved list a
-- retailer can pull from. All order-confirmation emails go to customerEmail + every contact email.
-- Run once in the Supabase SQL editor. No RLS change: both tables already scope by owner.

alter table public.quotes
  add column if not exists contacts jsonb not null default '[]'::jsonb;

alter table public.profile_addresses
  add column if not exists contacts jsonb not null default '[]'::jsonb;
