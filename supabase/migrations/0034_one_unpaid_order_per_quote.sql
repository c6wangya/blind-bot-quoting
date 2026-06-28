-- A quote now stays "draft" until payment actually succeeds (markOrderPaid flips it to converted),
-- so submitPreOrder no longer uses a draft→converted flip as its double-submit gate. This partial
-- unique index is the concurrency backstop: at most one unpaid (awaiting_payment) pre-order may
-- exist per quote, so two near-simultaneous "Confirm & pay" clicks can't both create an order and
-- double-reserve stock — the loser's INSERT fails and its reserved stock is released.
create unique index if not exists orders_one_awaiting_payment_per_quote
  on orders (quote_id)
  where status = 'awaiting_payment';
