-- Full-amount refund (admin-initiated, pre-shipment only). The order moves to a terminal "refunded"
-- status (analogous to "cancelled"): reserved motor stock is released and the quote is shown as
-- Refunded. We snapshot the admin's reason + an optional supporting document (image/PDF in the
-- existing private payment-proofs bucket) and when it happened.
alter table orders
  add column if not exists refund_reason   text,
  add column if not exists refund_doc_path text,
  add column if not exists refunded_at      timestamptz;

-- payment_status gains a terminal 'refunded' value (the CHECK from 0012 only allowed
-- pending/paid/failed). Drop + re-add so re-running is safe.
alter table orders drop constraint if exists orders_payment_status_chk;
alter table orders add constraint orders_payment_status_chk
  check (payment_status in ('pending','paid','failed','refunded'));

-- status also gains the terminal 'refunded' (0012's CHECK ended at 'cancelled').
alter table orders drop constraint if exists orders_status_chk;
alter table orders add constraint orders_status_chk
  check (status in ('awaiting_payment','submitted','acknowledged','in_production','shipped','in_transit','delivered','cancelled','refunded'));
