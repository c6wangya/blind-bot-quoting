-- Window ERP Phase B: hardware-part rules ride on deduction rows (brackets/screws per the
-- anchor MO forms: bracket count steps by width band, screws follow brackets), and cut
-- components gain an optional multiplier (zebra fabric length = 2 × drop + 12 — the banded
-- fabric is a doubled loop). Multiplier lives inside the components jsonb; only parts needs
-- a column.
alter table public.deduction_tables add column if not exists parts jsonb not null default '[]'::jsonb;
