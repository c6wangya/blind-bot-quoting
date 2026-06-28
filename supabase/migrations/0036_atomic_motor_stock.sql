-- THE-772 — Atomic motor stock reserve/restore (concurrency-safe).
-- Run in the Supabase SQL editor (quote project), after 0004 (accessory_inventory).
-- Idempotent (create or replace).
--
-- Replaces the app-side "read stock → optimistic CAS" loop in lib/db/motors.ts, which under
-- concurrency could (a) spuriously fail a request whose stock value merely changed even though
-- enough was left, and (b) lose a concurrent restore (non-atomic read-modify-write). Doing the
-- whole batch inside one plpgsql function = one transaction with row locks, so:
--   * never oversells (the decrement and the "enough?" check are one locked operation),
--   * never false-fails (condition is stock >= need, not stock == previously-read-value),
--   * never loses a restore (stock = stock + qty is atomic),
--   * all-or-nothing across models (a shortage in any model deducts none).

-- Reserve: p_needs = jsonb array of {model_id, qty}. Returns [] on success (stock deducted),
-- or [{model_id, left, need}, …] on shortage (NOTHING deducted). Models with no inventory row
-- are untracked (unlimited) and skipped. Rows are locked in model_id order to avoid deadlocks
-- between concurrent callers.
create or replace function public.reserve_motor_stock(p_needs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  need record;
  cur integer;
  shortages jsonb := '[]'::jsonb;
begin
  -- pass 1: lock the rows we'll touch (consistent order) and check availability
  for need in
    select (e->>'model_id') as model_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_needs) e
    group by (e->>'model_id')
    order by (e->>'model_id')
  loop
    select stock into cur from public.accessory_inventory
      where model_id = need.model_id for update;
    if not found then
      continue;  -- untracked = unlimited
    end if;
    if cur < need.qty then
      shortages := shortages || jsonb_build_object('model_id', need.model_id, 'left', cur, 'need', need.qty);
    end if;
  end loop;

  if jsonb_array_length(shortages) > 0 then
    return shortages;  -- nothing deducted; locks released when the txn ends
  end if;

  -- pass 2: apply (rows still locked within this transaction)
  for need in
    select (e->>'model_id') as model_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_needs) e
    group by (e->>'model_id')
    order by (e->>'model_id')
  loop
    update public.accessory_inventory
       set stock = stock - need.qty, updated_at = now()
     where model_id = need.model_id;
  end loop;

  return '[]'::jsonb;
end;
$$;

-- Restore: inverse of reserve (used on cancel / failed checkout). Atomic increments; untracked
-- models (no row) are no-ops.
create or replace function public.restore_motor_stock(p_needs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  need record;
begin
  for need in
    select (e->>'model_id') as model_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_needs) e
    group by (e->>'model_id')
    order by (e->>'model_id')
  loop
    update public.accessory_inventory
       set stock = stock + need.qty, updated_at = now()
     where model_id = need.model_id;
  end loop;
end;
$$;

grant execute on function public.reserve_motor_stock(jsonb) to anon, authenticated, service_role;
grant execute on function public.restore_motor_stock(jsonb) to anon, authenticated, service_role;
