-- Per-quote ship method for WINDOW-PRODUCT lines (anchor model: UPS Ground vs Will Call).
-- Deliberately its own column read only by window code paths (never added to the shared
-- QUOTE_COLS select), so deploys stay safe regardless of migration timing and non-window
-- quotes are untouched. Values match freight_rules.method.
alter table public.quotes add column if not exists window_ship_method text not null default 'ground';
