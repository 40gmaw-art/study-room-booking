-- Blocks reservations on specific 2026-10 dates directly in
-- validate_reservation_date(date), the shared security definer function
-- every reservation-creating RPC (create_reservation,
-- create_reservations_bulk, update_reservation_admin) already calls via
-- `perform public.validate_reservation_date(p_reservation_date);` -- so this
-- one change closes the server-side gate for all of them at once, including
-- a direct RPC call that bypasses the Next.js server actions entirely.
--
-- Dates blocked:
--   2026-10-05 -- substitute holiday for 개천절 (10/3, a Saturday)
--   2026-10-07 -- no separate holiday name, just unbookable
--   2026-10-09 -- 한글날
-- These would otherwise be ordinary bookable weekdays under the existing
-- weekday/rolling-window rule, so the check is a new, separate branch --
-- nothing about that existing rule changes. Mirrors
-- lib/booking.ts's BLOCKED_HOLIDAY_DATES (client + Next.js server-action
-- layer) so the two never drift.
--
-- Confirmed by reading supabase/schema.sql before writing this file:
-- validate_reservation_date(date) already exists with this exact signature
-- (unchanged since migration 0004); only its body changes here (one new
-- check added, nothing removed), so `create or replace` is safe (no drop/
-- signature change needed).
--
-- Does not touch tables, indexes, RLS policies, or any existing
-- reservations/profiles data. No DROP TABLE / TRUNCATE / DELETE of any kind.
-- Safe to re-run.

create or replace function public.validate_reservation_date(p_reservation_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
  v_today_seoul date := (now() at time zone 'Asia/Seoul')::date;
  v_today_iso_dow int := extract(isodow from v_today_seoul)::int;
  v_week_start date := v_today_seoul - (v_today_iso_dow - 1);
  v_start_date date := case when v_today_iso_dow >= 6 then v_week_start + 7 else v_today_seoul end;
  v_end_date date := v_week_start + 11;
begin
  if p_reservation_date < v_start_date then
    raise exception '예약 가능 기간이 아닙니다.' using errcode = '22023';
  end if;

  if p_reservation_date > v_end_date then
    raise exception '예약 가능 기간을 초과했습니다.' using errcode = '22023';
  end if;

  if extract(isodow from p_reservation_date)::int not between 1 and 5 then
    raise exception '평일만 예약할 수 있습니다.' using errcode = '22023';
  end if;

  if p_reservation_date in ('2026-10-05', '2026-10-07', '2026-10-09') then
    raise exception '공휴일은 예약할 수 없습니다.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.validate_reservation_date(date) from public;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, after this migration succeeds):
--
-- 1) function body picked up the change:
-- select prosrc from pg_proc where proname = 'validate_reservation_date';
-- -- expect to see "공휴일은 예약할 수 없습니다" in the body
--
-- 2) direct RPC check for a blocked date (as any authenticated user --
--    expect the '공휴일은 예약할 수 없습니다' exception, not a created row):
-- select * from public.validate_reservation_date('2026-10-05');
-- select * from public.validate_reservation_date('2026-10-07');
-- select * from public.validate_reservation_date('2026-10-09');
--
-- 3) an ordinary weekday within the normal rolling window still passes
--    (replace with a real current-window weekday before running):
-- select * from public.validate_reservation_date(current_date);
-- ────────────────────────────────────────────────────────────────────────
