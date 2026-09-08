-- Fixes: a single time slot could be booked by MULTIPLE different teams as
-- long as the SUM of their participant_count stayed at or under 8. Root
-- cause -- confirmed by reading supabase/schema.sql before writing this
-- file:
--   - get_time_slot_counts() returned SUM(participant_count) per slot, and
--     the client only treated a slot as "full"/disabled once that sum
--     reached MAX_PARTICIPANTS_PER_SLOT (8).
--   - create_reservation, create_reservations_bulk, and
--     update_reservation_admin all accepted a new reservation into a slot
--     as long as "existing sum + new participant_count <= 8".
--   - So e.g. a 4-person team booking a slot left it showing as having 4
--     seats "remaining", letting an unrelated second team book the same
--     slot -- this system's actual policy is one team per slot, not one
--     room-capacity-of-8 shared across teams.
--
-- Fix, in order of how strongly it's enforced:
--   1. A partial UNIQUE index on (reservation_date, start_time) WHERE
--      status = 'active' -- at most one ACTIVE reservation can ever exist
--      for a given slot, enforced by Postgres itself regardless of which
--      code path performs the INSERT/UPDATE. This is the actual guarantee
--      against concurrent double-booking (see note below on advisory
--      locks) and against any future code that bypasses the RPCs.
--   2. create_reservation, update_reservation_admin, and
--      create_reservations_bulk are updated to check "does ANY active
--      reservation already exist for this slot" (existence, not a
--      participant_count sum) before inserting, so a normal double-booking
--      attempt fails with a clear Korean message instead of a raw
--      constraint-violation error.
--   3. get_time_slot_counts() now returns a row COUNT per slot (0 or 1)
--      instead of a participant_count SUM, so the client's existing
--      "reservedByOthers" / "예약 마감" UI logic (components/booking-page.tsx)
--      -- which already treats any `full` slot as taken by someone else
--      when it isn't the current user's own reservation -- becomes correct
--      for teams of ANY size, not just teams of exactly 8. No frontend
--      code changes were needed for this: the bug was entirely in what
--      "full" meant on the backend.
--
-- On advisory locks: create_reservation, update_reservation_admin, and
-- create_reservations_bulk already took a pg_advisory_xact_lock keyed by
-- abs(hashtext(date || ':' || start_time)) before checking/inserting (see
-- 0001/0002_create_reservations_bulk.sql). Since all three student/admin
-- write paths share this exact lock keyspace, two concurrent requests for
-- the same slot were already serialized against EACH OTHER at the
-- application level -- the second call only proceeds after the first
-- commits or rolls back, and then correctly sees the first's row. The new
-- unique index in step 1 does not replace this; it is what still protects
-- correctness if some future write path is ever added that does NOT take
-- this lock.
--
-- IMPORTANT -- run this verification query FIRST, before applying this
-- migration, to check whether duplicate active bookings for the same
-- (date, start_time) already exist in production data:
--
--   select reservation_date, start_time, count(*) as active_reservation_count
--   from public.reservations
--   where status = 'active'
--   group by reservation_date, start_time
--   having count(*) > 1
--   order by reservation_date, start_time;
--
-- This migration does NOT delete, cancel, or merge any existing rows --
-- if that query returns any rows, the CREATE UNIQUE INDEX step below will
-- fail outright (Postgres refuses to build a unique index over data that
-- violates it) and, because this whole script is wrapped in one
-- transaction, the entire migration (including the function updates) rolls
-- back automatically -- nothing partial gets applied. In that case, resolve
-- (or ask a human to resolve) the conflicting rows manually before
-- re-running this file; this script intentionally does not decide that for
-- you.
--
-- Safe to re-run once it has succeeded.

begin;

create unique index if not exists reservations_one_active_per_slot_idx
on public.reservations (reservation_date, start_time)
where status = 'active';

create or replace function public.get_time_slot_counts(p_date date)
returns table (start_time time, active_count bigint)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select r.start_time, count(*)::bigint as active_count
  from public.reservations r
  where r.reservation_date = p_date and r.status = 'active'
  group by r.start_time
$$;

create or replace function public.create_reservation(
  p_reservation_date date,
  p_start_time time,
  p_name text,
  p_department text,
  p_student_number text,
  p_participant_count integer
)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_existing_slot_count int;
  v_reservation public.reservations;
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
  v_today_seoul date := (now() at time zone 'Asia/Seoul')::date;
  v_lock_key bigint;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
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

  if p_participant_count is null or p_participant_count < 2 or p_participant_count > 8 then
    raise exception '예약 인원은 2명 이상 8명 이하만 가능합니다.' using errcode = '22023';
  end if;

  perform public.validate_reservation_date(p_reservation_date);

  if p_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
    raise exception '허용되지 않은 시간대입니다.' using errcode = '22023';
  end if;

  if p_reservation_date = v_today_seoul and p_start_time <= to_char(v_now_seoul, 'HH24:MI:SS')::time then
    raise exception '이미 시작된 시간대는 예약할 수 없습니다.' using errcode = '22023';
  end if;

  v_lock_key := abs(hashtext(p_reservation_date::text || ':' || p_start_time::text))::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_existing_slot_count
  from public.reservations
  where reservation_date = p_reservation_date and start_time = p_start_time and status = 'active';

  if v_existing_slot_count > 0 then
    raise exception '%~ 시간대는 이미 다른 예약이 있어 추가할 수 없습니다.', to_char(p_start_time, 'HH24:MI') using errcode = '22023';
  end if;

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
    p_start_time,
    'active',
    p_participant_count,
    now(),
    now()
  )
  returning * into v_reservation;

  return v_reservation;
end;
$$;

create or replace function public.update_reservation_admin(
  p_reservation_id uuid,
  p_reservation_date date,
  p_start_time time,
  p_name text,
  p_department text,
  p_student_number text,
  p_participant_count integer
)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reservation public.reservations%rowtype;
  v_lock_key bigint;
  v_existing_slot_count int;
begin
  if not public.is_admin_user() then
    raise exception '관리자만 예약을 수정할 수 있습니다.' using errcode = '42501';
  end if;

  if p_participant_count is null or p_participant_count < 2 or p_participant_count > 8 then
    raise exception '예약 인원은 2명 이상 8명 이하만 가능합니다.' using errcode = '22023';
  end if;

  perform public.validate_reservation_date(p_reservation_date);

  if p_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
    raise exception '허용되지 않은 시간대입니다.' using errcode = '22023';
  end if;

  select * into v_reservation
  from public.reservations
  where id = p_reservation_id
  limit 1;

  if not found then
    raise exception '존재하지 않는 예약입니다.' using errcode = '22023';
  end if;

  v_lock_key := abs(hashtext(p_reservation_date::text || ':' || p_start_time::text))::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_existing_slot_count
  from public.reservations
  where reservation_date = p_reservation_date
    and start_time = p_start_time
    and status = 'active'
    and id <> p_reservation_id;

  if v_existing_slot_count > 0 then
    raise exception '%~ 시간대는 이미 다른 예약이 있어 이동할 수 없습니다.', to_char(p_start_time, 'HH24:MI') using errcode = '22023';
  end if;

  update public.reservations
  set
    reservation_date = p_reservation_date,
    start_time = p_start_time,
    name = p_name,
    department = p_department,
    student_number = p_student_number,
    participant_count = p_participant_count,
    updated_at = now()
  where id = p_reservation_id;

  select * into v_reservation
  from public.reservations
  where id = p_reservation_id;

  return v_reservation;
end;
$$;

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
  v_existing_count int;
  v_existing_slot_count int;
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

    select count(*) into v_existing_slot_count
    from public.reservations
    where reservation_date = p_reservation_date and start_time = v_start_time and status = 'active';

    if v_existing_slot_count > 0 then
      raise exception '%~% 시간대는 이미 다른 사용자가 예약한 시간대입니다. 전체 예약이 취소되었습니다.',
        to_char(v_start_time, 'HH24:MI'),
        to_char(v_start_time + interval '1 hour', 'HH24:MI')
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

commit;

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, after this migration succeeds):
--
-- 1) the new index exists and is valid:
-- select indexname, indexdef from pg_indexes
-- where tablename = 'reservations' and indexname = 'reservations_one_active_per_slot_idx';
--
-- 2) functional check (as a real logged-in user via the app, not SQL
-- Editor, since auth.uid() must resolve to a real profile):
-- - User A books 10:00-11:00 on some allowed date -> succeeds.
-- - User B tries to book the SAME date's 10:00-11:00 -> rejected with
--   "...이미 다른 사용자가 예약한 시간대입니다..." and, on the booking page,
--   that slot shows "예약 마감" and is disabled for B (and "이미 예약됨"
--   and disabled for A).
-- - User B books 11:00-12:00 on the same date -> succeeds.
-- - A cancels 10:00-11:00 -> the slot becomes bookable again for anyone.
-- ────────────────────────────────────────────────────────────────────────
