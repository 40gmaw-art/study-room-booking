-- Fixes: a student could cancel a reservation whose slot had ALREADY
-- STARTED (not just already ended). Since the "max 4 hours per user per
-- day" budget (create_reservations_bulk) only counts ACTIVE reservations,
-- cancelling an already-started slot immediately freed up that hour again,
-- letting a student re-book more time the same day and exceed 4 real hours
-- of usage -- e.g. book 10:00-12:00, let it start, cancel it at 12:30, and
-- the system now thinks 0 of the 4-hour budget is used.
--
-- Confirmed by reading supabase/schema.sql before writing this file:
--   - cancel_reservation(text) already exists with this exact signature
--     (unchanged since it was first added); only its body changes here
--     (a new check added, nothing removed), so `create or replace` is safe
--     (no drop/signature change needed).
--   - reservation_date (date) and start_time (time) are stored as plain
--     Postgres date/time values representing Seoul wall-clock (this is the
--     same convention create_reservation/create_reservations_bulk already
--     rely on via `now() at time zone 'Asia/Seoul'`), so
--     `v_reservation.reservation_date + v_reservation.start_time` is a
--     timestamp directly comparable to that same "Seoul now" -- no new
--     timezone-handling approach introduced.
--   - is_admin_user() already exists and is already used for an exemption
--     on the ownership check just above in this same function; the new
--     check reuses the identical exemption style for consistency.
--
-- Does not delete or invalidate any existing reservations/profiles data.
-- No DROP TABLE / TRUNCATE / bulk DELETE of any kind.
-- Safe to re-run.

create or replace function public.cancel_reservation(p_reservation_number text)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  select * into v_reservation
  from public.reservations
  where reservation_number = p_reservation_number
  limit 1;

  if not found then
    raise exception '존재하지 않는 예약번호입니다.' using errcode = '22023';
  end if;

  if v_reservation.status = 'cancelled' then
    raise exception '이미 취소된 예약입니다.' using errcode = '22023';
  end if;

  if v_reservation.user_id <> v_user_id and not public.is_admin_user() then
    raise exception '본인의 예약만 취소할 수 있습니다.' using errcode = '42501';
  end if;

  -- Cancellable only while the slot's START time has not yet arrived (its
  -- own reservation_date + start_time, not "today" in general -- a past
  -- DATE is caught by the same comparison since it's always <= now).
  -- Otherwise cancelling an already-started slot would free up its hour in
  -- the daily 4-hour budget after the student already used it, letting the
  -- 4-hour cap be bypassed. Admins are exempt, matching the ownership check
  -- just above.
  if (v_reservation.reservation_date + v_reservation.start_time) <= v_now_seoul and not public.is_admin_user() then
    raise exception '이미 이용이 시작된 예약은 취소할 수 없습니다.' using errcode = '22023';
  end if;

  update public.reservations
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_reservation.id;

  select * into v_reservation
  from public.reservations
  where id = v_reservation.id;

  return v_reservation;
end;
$$;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, after this migration succeeds):
--
-- 1) function body picked up the change:
-- select prosrc from pg_proc where proname = 'cancel_reservation';
-- -- expect to see "이미 이용이 시작된 예약은 취소할 수 없습니다" in the body
--
-- 2) functional check (as a real logged-in student via the app, not SQL
-- Editor, since auth.uid() must resolve to a real profile):
-- - Book an allowed date's slot whose start time is a few minutes in the
--   future -> cancel succeeds now, fails once that start time passes.
-- - Book today's slot that has already started (if the booking policy
--   allows same-day booking of a not-yet-started hour, wait for it to
--   start) -> cancelling it is rejected with the new message.
-- - Book a future date's slot -> cancellable at any time before that
--   date/hour arrives, exactly as before.
-- ────────────────────────────────────────────────────────────────────────
