-- THE-772 — let a support message reference specific quote/order line items, so the customer can
-- ask about a particular product or accessory and the admin sees exactly which one(s). Run in the
-- Supabase SQL editor. Idempotent. Holds a snapshot array
-- ([{ name, sku, image, summary, qty }]) so the references still render after the quote is edited.
alter table public.messages add column if not exists item_refs jsonb;
