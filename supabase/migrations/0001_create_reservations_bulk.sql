-- Adds a bulk-booking RPC so a student can reserve multiple time slots for the
-- same date in one atomic transaction. Safe to re-run: only adds a new
-- function via CREATE OR REPLACE and does not modify existing tables, data,
-- policies, or the existing single-slot create_reservation() RPC.

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

  -- de-duplicate and sort ascending so concurrent bulk calls always acquire
  -- advisory locks in the same global order (prevents deadlocks).
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

  -- pass 3: re-validate capacity and duplicate-booking rules under lock
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

  -- pass 4: all slots validated -> insert every reservation
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

revoke all on function public.create_reservations_bulk(date, time[], text, text, text) from public;
grant execute on function public.create_reservations_bulk(date, time[], text, text, text) to authenticated;
