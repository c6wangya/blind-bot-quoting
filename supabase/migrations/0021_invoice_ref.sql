-- THE-772 — printable customer invoice (proforma on a draft quote; final once the quote is
-- a paid order). The invoice's number must be unique, sequential and immutable once issued, so
-- we lazily assign one INV-YYYY-#### ref onto the quote the first time an invoice is generated
-- and never recompute it. No separate invoices table: the order a quote converts into already
-- persists the financial record (amount, discount, payment status), so the invoice is a
-- presentation layer over quote (+ its order). Run in the Supabase SQL editor. Idempotent.

alter table public.quotes add column if not exists invoice_ref text;

-- One ref per quote, globally unique (partial so un-invoiced quotes don't collide on NULL).
create unique index if not exists quotes_invoice_ref_idx
  on public.quotes(invoice_ref) where invoice_ref is not null;
