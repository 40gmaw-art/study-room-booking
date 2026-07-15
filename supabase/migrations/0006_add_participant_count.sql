-- Changes the per-slot capacity model from "row count" to "sum of
-- participant_count", and raises the per-slot cap from 4 to 6.
--
-- Confirmed by reading supabase/schema.sql before writing this file:
--   - public.reservations has NO existing column for headcount/party size,
--     so a new column is added (not a rename of something pre-existing).
--   - public.reservations.id is uuid (used unchanged below).
--   - capacity was previously enforced via `count(*) >= 4` in
--     create_reservation / create_reservations_bulk, and via
--     `count(*)::bigint` in get_time_slot_counts.
--   - validate_reservation_date(date) already exists (added in
--     0004_fix_validate_reservation_date.sql) and is reused as-is; no new
--     RPC in this file invents a helper that doesn't already exist.
--
-- Does not delete or invalidate any existing reservations/profiles data.
-- No DROP TABLE / TRUNCATE / bulk DELETE of any kind.
-- Safe to re-run.

-- ────────────────────────────────────────────────────────────────────────
-- Step 1: add participant_count, backfilling every existing row to 1.
-- ────────────────────────────────────────────────────────────────────────
alter table public.reservations
  add column if not exists participant_count integer not null default 1;

update public.reservations
set participant_count = 1
where participant_count is null;

alter table public.reservations
  drop constraint if exists reservations_participant_count_check;

alter table public.reservations
  add constraint reservations_participant_count_check
  check (participant_count >= 1 and participant_count <= 6);

-- ────────────────────────────────────────────────────────────────────────
-- Step 2: drop the 3 functions whose signature is changing (new trailing
-- p_participant_count parameter), regardless of their currently-installed
-- signature, so no ambiguous/stale overload is left behind for PostgREST.
-- get_time_slot_counts, cancel_reservation, and admin_delete_reservation
-- keep their existing signatures (only get_time_slot_counts' body changes),
-- so they are safely handled with CREATE OR REPLACE below instead.
-- ────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_reservation', 'create_reservations_bulk', 'update_reservation_admin')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- Step 3: capacity now sums participant_count instead of counting rows.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.get_time_slot_counts(p_date date)
returns table (start_time time, active_count bigint)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select r.start_time, coalesce(sum(r.participant_count), 0)::bigint as active_count
  from public.reservations r
  where r.reservation_date = p_date and r.status = 'active'
  group by r.start_time
$$;

-- Single-slot reservation (used by the admin "새 예약 추가" form).
create function public.create_reservation(
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

  if p_participant_count is null or p_participant_count < 1 or p_participant_count > 6 then
    raise exception '예약 인원은 1명 이상 6명 이하만 가능합니다.' using errcode = '22023';
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

  if v_current_total + p_participant_count > 6 then
    raise exception '해당 시간대는 잔여 인원(%명)이 부족하여 %명을 예약할 수 없습니다.', greatest(6 - v_current_total, 0), p_participant_count using errcode = '22023';
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

-- Admin edit: capacity check excludes this reservation's own current
-- contribution before adding the new participant count back in, so
-- shrinking/growing the same reservation in place works correctly.
create function public.update_reservation_admin(
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

  if p_participant_count is null or p_participant_count < 1 or p_participant_count > 6 then
    raise exception '예약 인원은 1명 이상 6명 이하만 가능합니다.' using errcode = '22023';
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

  if v_current_total + p_participant_count > 6 then
    raise exception '해당 시간대는 잔여 인원(%명)이 부족하여 수정할 수 없습니다.', greatest(6 - v_current_total, 0) using errcode = '22023';
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

-- Bulk booking: same participant_count is written to every selected slot's
-- own reservation row (not split across slots). One transaction: if any
-- selected slot cannot fit p_participant_count, the whole call raises and
-- nothing is inserted.
create function public.create_reservations_bulk(
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

  if p_participant_count is null or p_participant_count < 1 or p_participant_count > 6 then
    raise exception '예약 인원은 1명 이상 6명 이하만 가능합니다.' using errcode = '22023';
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

  -- pass 1: reject unknown / already-started slots before taking any locks
  foreach v_start_time in array v_sorted_times loop
    if v_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
      raise exception '허용되지 않은 시간대가 포함되어 있습니다.' using errcode = '22023';
    end if;

    if p_reservation_date = v_today_seoul and v_start_time <= to_char(v_now_seoul, 'HH24:MI:SS')::time then
      raise exception '%~ 시간대는 이미 시작되어 예약할 수 없습니다.', to_char(v_start_time, 'HH24:MI') using errcode = '22023';
    end if;
  end loop;

  -- pass 2: lock every requested slot (ascending order) before checking capacity
  foreach v_start_time in array v_sorted_times loop
    v_lock_key := abs(hashtext(p_reservation_date::text || ':' || v_start_time::text))::bigint;
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  -- pass 3: re-validate duplicate-booking + capacity (sum of
  -- participant_count) under lock -- never trust client-supplied counts.
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

    if v_current_total + p_participant_count > 6 then
      raise exception '%~% 시간대는 현재 잔여 인원이 %명이므로 %명을 예약할 수 없습니다. 전체 예약이 취소되었습니다.',
        to_char(v_start_time, 'HH24:MI'),
        to_char(v_start_time + interval '1 hour', 'HH24:MI'),
        greatest(6 - v_current_total, 0),
        p_participant_count
      using errcode = '22023';
    end if;
  end loop;

  -- pass 4: all slots validated under lock -> insert every reservation with
  -- the SAME participant_count. If anything above raised, this point is
  -- never reached and the whole call (one transaction) rolls back.
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

-- ────────────────────────────────────────────────────────────────────────
-- Step 4: permissions for the new signatures (idempotent).
-- ────────────────────────────────────────────────────────────────────────
revoke all on function public.create_reservation(date, time, text, text, text, integer) from public;
revoke all on function public.update_reservation_admin(uuid, date, time, text, text, text, integer) from public;
revoke all on function public.create_reservations_bulk(date, time[], text, text, text, integer) from public;

grant execute on function public.create_reservation(date, time, text, text, text, integer) to authenticated;
grant execute on function public.update_reservation_admin(uuid, date, time, text, text, text, integer) to authenticated;
grant execute on function public.create_reservations_bulk(date, time[], text, text, text, integer) to authenticated;

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, not part of the fix):
--
-- 1) column + constraint exist, existing rows backfilled to 1:
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'reservations' and column_name = 'participant_count';
--
-- select count(*) as rows_missing_backfill from public.reservations where participant_count is null;
-- -- expect 0
--
-- 2) no stale/duplicate overloads remain:
-- select p.proname, pg_get_function_identity_arguments(p.oid) as arg_types
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('create_reservation', 'create_reservations_bulk', 'update_reservation_admin');
-- -- expect exactly 1 row per function name, each ending in "... integer"
--
-- 3) capacity now reflects participant_count sums:
-- select * from public.get_time_slot_counts(current_date);
-- ────────────────────────────────────────────────────────────────────────
