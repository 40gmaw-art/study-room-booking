-- Enforces "max 4 hours per user per day" (summed across ALL of that user's
-- active reservations on a date), on top of the existing "max 4 hours per
-- single booking request" limit. Previously a user could book 4 hours, come
-- back, and book more hours the same day with no cap on the running total.
--
-- Confirmed by reading supabase/schema.sql before writing this file:
--   - create_reservations_bulk already exists with this exact
--     (date, time[], text, text, text, integer) signature (unchanged since
--     0006/0007); only its body changes here, so `create or replace` is
--     safe (no drop/signature change needed).
--   - Per-slot room-capacity locking already uses
--     abs(hashtext(date || ':' || start_time))::bigint via
--     pg_advisory_xact_lock; the new per-user daily lock below reuses the
--     same pattern with a distinct keyspace (user_id + date + ':daily'
--     suffix) so it cannot collide with or deadlock against the per-slot
--     locks.
--   - create_reservation and update_reservation_admin are intentionally
--     NOT touched: both are admin-only paths (the admin "새 예약 추가"/수정
--     forms) that don't represent a logged-in student's own booking
--     session, so the per-student daily budget does not apply to them.
--
-- Does not delete or invalidate any existing reservations/profiles data.
-- No DROP TABLE / TRUNCATE / bulk DELETE of any kind.
-- Safe to re-run.

create or replace function public.create_reservations_bulk(
  p_reservation_date date,
  p_start_times time[],
  p_name text,
  p_department text,
  p_student_number text,
  p_participant_count integer
)
returns setof public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_current_total bigint;
  v_existing_count int;
  v_existing_daily_slots int;
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
  v_today_seoul date := (now() at time zone 'Asia/Seoul')::date;
  v_lock_key bigint;
  v_daily_lock_key bigint;
  v_start_time time;
  v_sorted_times time[];
  v_reservation public.reservations%rowtype;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;

  if p_start_times is null or array_length(p_start_times, 1) is null then
    raise exception '예약할 시간대를 선택해 주세요.' using errcode = '22023';
  end if;

  if p_participant_count is null or p_participant_count < 2 or p_participant_count > 8 then
    raise exception '예약 인원은 2명 이상 8명 이하만 가능합니다.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if v_profile.id is null then
    raise exception '프로필 정보가 필요합니다.' using errcode = '42501';
  end if;

  if coalesce(v_profile.email, '') !~ '@gachon\.ac\.kr$' then
    raise exception '가천대학교 이메일만 예약할 수 있습니다.' using errcode = '42501';
  end if;

  if coalesce(v_profile.name, '') = '' or coalesce(v_profile.department, '') = '' or coalesce(v_profile.student_number, '') = '' then
    raise exception '프로필 정보가 완성되어야 합니다.' using errcode = '42501';
  end if;

  perform public.validate_reservation_date(p_reservation_date);

  select array_agg(distinct t order by t) into v_sorted_times
  from unnest(p_start_times) as t;

  foreach v_start_time in array v_sorted_times loop
    if v_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
      raise exception '허용되지 않은 시간대가 포함되어 있습니다.' using errcode = '22023';
    end if;

    if p_reservation_date = v_today_seoul and v_start_time <= to_char(v_now_seoul, 'HH24:MI:SS')::time then
      raise exception '%~ 시간대는 이미 시작되어 예약할 수 없습니다.', to_char(v_start_time, 'HH24:MI') using errcode = '22023';
    end if;
  end loop;

  -- Daily cap: this user's ACTIVE reservations for THIS date, summed with
  -- the new slots being requested now, must not exceed 4 hours total.
  -- Locked on (user_id, date) -- a keyspace distinct from the per-slot locks
  -- below -- so two concurrent requests from the same user for the same
  -- date serialize here instead of both reading "0 used" and both
  -- succeeding. This is what actually prevents the daily limit from being
  -- bypassed by simultaneous requests (the client-side check in
  -- lib/booking-actions.ts is a fast-path UX nicety only, not a guarantee).
  v_daily_lock_key := abs(hashtext(v_user_id::text || ':' || p_reservation_date::text || ':daily'))::bigint;
  perform pg_advisory_xact_lock(v_daily_lock_key);

  select count(*) into v_existing_daily_slots
  from public.reservations
  where user_id = v_user_id
    and reservation_date = p_reservation_date
    and status = 'active';

  if v_existing_daily_slots + array_length(v_sorted_times, 1) > 4 then
    raise exception '해당 날짜에는 이미 %시간을 예약하셨습니다. 하루 최대 4시간까지만 예약할 수 있어 %시간만 추가로 예약하실 수 있습니다.',
      v_existing_daily_slots,
      greatest(4 - v_existing_daily_slots, 0)
      using errcode = '22023';
  end if;

  foreach v_start_time in array v_sorted_times loop
    v_lock_key := abs(hashtext(p_reservation_date::text || ':' || v_start_time::text))::bigint;
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  foreach v_start_time in array v_sorted_times loop
    select count(*) into v_existing_count
    from public.reservations
    where user_id = v_user_id
      and reservation_date = p_reservation_date
      and start_time = v_start_time
      and status = 'active';

    if v_existing_count > 0 then
      raise exception '%~ 시간대는 이미 예약하신 시간대입니다.', to_char(v_start_time, 'HH24:MI') using errcode = '22023';
    end if;

    select coalesce(sum(participant_count), 0) into v_current_total
    from public.reservations
    where reservation_date = p_reservation_date and start_time = v_start_time and status = 'active';

    if v_current_total + p_participant_count > 8 then
      raise exception '%~% 시간대는 현재 잔여 인원이 %명이므로 %명을 예약할 수 없습니다. 전체 예약이 취소되었습니다.',
        to_char(v_start_time, 'HH24:MI'),
        to_char(v_start_time + interval '1 hour', 'HH24:MI'),
        greatest(8 - v_current_total, 0),
        p_participant_count
      using errcode = '22023';
    end if;
  end loop;

  foreach v_start_time in array v_sorted_times loop
    insert into public.reservations (
      reservation_number,
      user_id,
      name,
      department,
      student_number,
      reservation_date,
      start_time,
      status,
      participant_count,
      created_at,
      updated_at
    )
    values (
      public.generate_reservation_number(),
      v_user_id,
      coalesce(p_name, v_profile.name),
      coalesce(p_department, v_profile.department),
      coalesce(p_student_number, v_profile.student_number),
      p_reservation_date,
      v_start_time,
      'active',
      p_participant_count,
      now(),
      now()
    )
    returning * into v_reservation;

    return next v_reservation;
  end loop;

  return;
end;
$$;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, not part of the fix):
--
-- 1) function body picked up the change:
-- select prosrc from pg_proc where proname = 'create_reservations_bulk';
-- -- expect to see "daily" / "v_existing_daily_slots" in the body
--
-- 2) manual functional check (as a real logged-in user via the app, not
-- SQL Editor, since auth.uid() must resolve to a real profile):
-- - Book 10:00-14:00 (4 hours) on some allowed date -> succeeds.
-- - Try to book 14:00-15:00 on the SAME date -> rejected with the new
--   "해당 날짜에는 이미 4시간을 예약하셨습니다..." message.
-- - Cancel the 10:00-11:00 slot, try 14:00-15:00 again -> succeeds (3 of 4
--   hours now active, 1 hour requested).
-- ────────────────────────────────────────────────────────────────────────
