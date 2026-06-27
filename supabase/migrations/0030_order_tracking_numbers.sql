-- THE-772 — multiple tracking numbers per shipment. Run in the Supabase SQL editor.
-- The supplier can issue several tracking numbers when an order ships in multiple parcels.
-- `tracking_nos` holds the full list; the legacy `tracking_no` column keeps the first one so the
-- orders list column + search keep working unchanged. Idempotent + safe on existing data.
alter table public.orders add column if not exists tracking_nos jsonb;
