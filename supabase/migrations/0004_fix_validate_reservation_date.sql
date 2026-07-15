-- Fix for: "function public.validate_reservation_date(date) does not exist"
--
-- Root cause: public.validate_reservation_date(date) is defined in
-- supabase/schema.sql (the base/foundational schema) and is called by
-- create_reservation, update_reservation_admin, and create_reservations_bulk
-- via `perform public.validate_reservation_date(p_reservation_date);` where
-- p_reservation_date is typed `date` in every caller — the calling
-- signature was never wrong. The error means this specific helper function
-- (and possibly its sibling helper functions below) was never actually
-- created on the live database, even though the RPCs that depend on it were.
--
-- This migration is self-contained: running this ONE file recreates
-- validate_reservation_date and every function in its call chain, so the
-- booking flow works regardless of which earlier migrations were or weren't
-- applied. It does not touch tables, indexes, RLS policies, or any existing
-- reservations/profiles data.
--
-- Safe to re-run. No DROP TABLE / TRUNCATE / DELETE of any kind.

-- Step 1: remove any existing validate_reservation_date overload(s),
-- regardless of exact signature, so there is no ambiguity for Postgres or
-- PostgREST about which function to call.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validate_reservation_date'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end;
$$;

-- Step 2: recreate the full dependency chain (idempotent CREATE OR REPLACE),
-- copied verbatim from supabase/schema.sql, so this file alone is enough.

create or replace function public.generate_reservation_number()
returns text
language plpgsql
as $$
declare
  date_part text;
  random_part text;
begin
  date_part := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD');
  random_part := upper(substr(md5(random()::text), 1, 6));
  return format('GSR-%s-%s', date_part, random_part);
end;
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

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

-- The actual fix: public.validate_reservation_date(date), returns void,
-- raises an exception directly rather than returning a boolean (callers use
-- `perform public.validate_reservation_date(...)`, confirmed from the
-- existing call sites, not guessed).
create function public.validate_reservation_date(p_reservation_date date)
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
end;
$$;

create or replace function public.create_reservation(
  p_reservation_date date,
  p_start_time time,
  p_name text,
  p_department text,
  p_student_number text
)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_count bigint;
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

  perform public.validate_reservation_date(p_reservation_date);

  if p_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
    raise exception '허용되지 않은 시간대입니다.' using errcode = '22023';
  end if;

  if p_reservation_date = v_today_seoul and p_start_time <= to_char(v_now_seoul, 'HH24:MI:SS')::time then
    raise exception '이미 시작된 시간대는 예약할 수 없습니다.' using errcode = '22023';
  end if;

  v_lock_key := abs(hashtext(p_reservation_date::text || ':' || p_start_time::text))::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_count
  from public.reservations
  where reservation_date = p_reservation_date and start_time = p_start_time and status = 'active';

  if v_count >= 4 then
    raise exception '해당 시간대는 이미 만석입니다.' using errcode = '22023';
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
  p_student_number text
)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reservation public.reservations%rowtype;
  v_lock_key bigint;
begin
  if not public.is_admin_user() then
    raise exception '관리자만 예약을 수정할 수 있습니다.' using errcode = '42501';
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

  update public.reservations
  set
    reservation_date = p_reservation_date,
    start_time = p_start_time,
    name = p_name,
    department = p_department,
    student_number = p_student_number,
    updated_at = now()
  where id = p_reservation_id;

  select * into v_reservation
  from public.reservations
  where id = p_reservation_id;

  return v_reservation;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_number text)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.reservations%rowtype;
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

  update public.reservations
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_reservation.id;

  select * into v_reservation
  from public.reservations
  where id = v_reservation.id;

  return v_reservation;
end;
$$;

create or replace function public.create_reservations_bulk(
  p_reservation_date date,
  p_start_times time[],
  p_name text,
  p_department text,
  p_student_number text
)
returns setof public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_count bigint;
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

    select count(*) into v_count
    from public.reservations
    where reservation_date = p_reservation_date and start_time = v_start_time and status = 'active';

    if v_count >= 4 then
      raise exception '%~ 시간대의 예약이 마감되어 전체 예약이 취소되었습니다.', to_char(v_start_time, 'HH24:MI') using errcode = '22023';
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
      now(),
      now()
    )
    returning * into v_reservation;

    return next v_reservation;
  end loop;

  return;
end;
$$;

-- Step 3: permissions (idempotent; safe to re-run).
revoke all on function public.generate_reservation_number() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.get_time_slot_counts(date) from public;
revoke all on function public.validate_reservation_date(date) from public;
revoke all on function public.create_reservation(date, time, text, text, text) from public;
revoke all on function public.update_reservation_admin(uuid, date, time, text, text, text) from public;
revoke all on function public.cancel_reservation(text) from public;
revoke all on function public.create_reservations_bulk(date, time[], text, text, text) from public;

grant execute on function public.is_admin_user() to authenticated;
grant execute on function public.get_time_slot_counts(date) to authenticated;
grant execute on function public.create_reservation(date, time, text, text, text) to authenticated;
grant execute on function public.update_reservation_admin(uuid, date, time, text, text, text) to authenticated;
grant execute on function public.cancel_reservation(text) to authenticated;
grant execute on function public.create_reservations_bulk(date, time[], text, text, text) to authenticated;

-- Step 4: make PostgREST pick up these functions immediately.
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Verification queries — run these separately after the migration above to
-- confirm the fix. Not part of the fix itself.
-- ────────────────────────────────────────────────────────────────────────

-- 1) validate_reservation_date(date) exists exactly once, with the right
--    argument and return types:
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as arg_types,
--        t.typname as return_type
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- join pg_type t on t.oid = p.prorettype
-- where n.nspname = 'public' and p.proname = 'validate_reservation_date';
-- -- expect exactly 1 row: arg_types = 'p_reservation_date date', return_type = 'void'

-- 2) create_reservations_bulk exists:
-- select p.proname, pg_get_function_identity_arguments(p.oid) as arg_types
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_reservations_bulk';

-- 3) end-to-end smoke test (replace the date with a valid weekday within the
--    allowed range before running, and expect either a successful row or a
--    business-rule exception -- NOT "function ... does not exist"):
-- select * from public.validate_reservation_date(current_date);
