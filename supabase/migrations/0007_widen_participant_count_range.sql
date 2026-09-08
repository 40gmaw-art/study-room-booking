-- Widens the per-reservation headcount range from 1-6 to 2-8, and raises the
-- per-slot capacity cap (sum of participant_count for a slot) from 6 to 8 to
-- match -- otherwise a party of 7-8 could never fit into even an empty slot.
--
-- Confirmed by reading supabase/schema.sql before writing this file:
--   - public.reservations.participant_count already exists (added in
--     0006_add_participant_count.sql) with check (>= 1 and <= 6); only the
--     bounds change here, the column itself is untouched.
--   - create_reservation, update_reservation_admin, create_reservations_bulk
--     already exist with this exact (date, time[]/time, text, text, text,
--     integer) signature (unchanged since 0006); only the literal 1/6
--     bounds inside each body change here, so `create or replace` is safe
--     (no drop/signature change needed).
--
-- Does not delete or invalidate any existing reservations/profiles data.
-- No DROP TABLE / TRUNCATE / bulk DELETE of any kind.
-- Safe to re-run.
--
-- IMPORTANT: existing rows may already have participant_count = 1 (the old
-- minimum/default). The new constraint is added with NOT VALID so it is
-- enforced only for future inserts/updates and never re-validated against
-- historical rows -- old 1-person reservations stay exactly as they are.

-- ────────────────────────────────────────────────────────────────────────
-- Step 1: widen the column's allowed range and default.
-- ────────────────────────────────────────────────────────────────────────
alter table public.reservations
  alter column participant_count set default 2;

alter table public.reservations
  drop constraint if exists reservations_participant_count_check;

alter table public.reservations
  add constraint reservations_participant_count_check
  check (participant_count >= 2 and participant_count <= 8)
  not valid;

-- ────────────────────────────────────────────────────────────────────────
-- Step 2: update the 3 functions that validate/enforce this range. Same
-- signatures as before, so create-or-replace is enough (no drop needed).
-- ────────────────────────────────────────────────────────────────────────
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
  v_current_total bigint;
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

  select coalesce(sum(participant_count), 0) into v_current_total
  from public.reservations
  where reservation_date = p_reservation_date and start_time = p_start_time and status = 'active';

  if v_current_total + p_participant_count > 8 then
    raise exception '해당 시간대는 잔여 인원(%명)이 부족하여 %명을 예약할 수 없습니다.', greatest(8 - v_current_total, 0), p_participant_count using errcode = '22023';
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
  v_current_total bigint;
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

  select coalesce(sum(participant_count), 0) into v_current_total
  from public.reservations
  where reservation_date = p_reservation_date
    and start_time = p_start_time
    and status = 'active'
    and id <> p_reservation_id;

  if v_current_total + p_participant_count > 8 then
    raise exception '해당 시간대는 잔여 인원(%명)이 부족하여 수정할 수 없습니다.', greatest(8 - v_current_total, 0) using errcode = '22023';
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
  v_current_total bigint;
  v_existing_count int;
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
  v_today_seoul date := (now() at time zone 'Asia/Seoul')::date;
  v_lock_key bigint;
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
-- select column_name, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'reservations' and column_name = 'participant_count';
-- -- expect column_default = '2'
--
-- select conname, pg_get_constraintdef(oid), convalidated
-- from pg_constraint
-- where conrelid = 'public.reservations'::regclass and conname = 'reservations_participant_count_check';
-- -- expect: CHECK ((participant_count >= 2) AND (participant_count <= 8)) NOT VALID, convalidated = false
-- -- (NOT VALID is intentional -- see note above; it still applies to every
-- -- new insert/update from now on, it just doesn't re-check old rows)
--
-- -- existing rows with participant_count 1 (pre-existing bookings) are
-- -- NOT touched by this migration and remain valid history; only NEW
-- -- inserts/updates are bound by the new 2-8 check.
-- ────────────────────────────────────────────────────────────────────────
