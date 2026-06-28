-- Support multiple supporting documents per refund (was a single refund_doc_path text in 0035).
-- Mirrors the tracking_nos jsonb-array pattern. The old single-value column is migrated then left
-- in place (harmless); the app reads/writes refund_doc_paths only.
alter table orders add column if not exists refund_doc_paths jsonb;
update orders
  set refund_doc_paths = jsonb_build_array(refund_doc_path)
  where refund_doc_path is not null and refund_doc_paths is null;
