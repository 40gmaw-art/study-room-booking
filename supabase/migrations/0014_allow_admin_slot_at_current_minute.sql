begin;

create or replace function public.create_reservations_admin_bulk(
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
  v_sorted_times time[];
  v_reservation public.reservations%rowtype;
  v_start_time time;
  v_index integer;
  v_lock_key bigint;
  v_existing_slot_count integer;
  v_now_seoul timestamp := (now() at time zone 'Asia/Seoul');
  v_today_seoul date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_admin_user() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise exception '이름을 입력해 주세요.' using errcode = '22023';
  end if;

  if nullif(btrim(p_department), '') is null then
    raise exception '학과를 입력해 주세요.' using errcode = '22023';
  end if;

  if nullif(btrim(p_student_number), '') is null then
    raise exception '학번을 입력해 주세요.' using errcode = '22023';
  end if;

  if p_participant_count is null or p_participant_count < 2 or p_participant_count > 8 then
    raise exception '예약 인원은 2명 이상 8명 이하만 가능합니다.' using errcode = '22023';
  end if;

  perform public.validate_reservation_date(p_reservation_date);

  if p_start_times is null or array_length(p_start_times, 1) is null then
    raise exception '예약할 시간대를 선택해 주세요.' using errcode = '22023';
  end if;

  select array_agg(distinct t order by t)
    into v_sorted_times
  from unnest(p_start_times) as t;

  if array_length(v_sorted_times, 1) < 1 or array_length(v_sorted_times, 1) > 4 then
    raise exception '한 번의 예약은 1시간 이상 4시간 이하로 선택해 주세요.' using errcode = '22023';
  end if;

  for v_index in 2..array_length(v_sorted_times, 1) loop
    if v_sorted_times[v_index] <> v_sorted_times[v_index - 1] + interval '1 hour' then
      raise exception '예약 시간대는 연속해서 선택해 주세요.' using errcode = '22023';
    end if;
  end loop;

  foreach v_start_time in array v_sorted_times loop
    if v_start_time not in ('10:00:00','11:00:00','12:00:00','13:00:00','14:00:00','15:00:00','16:00:00') then
      raise exception '허용되지 않은 시간대가 포함되어 있습니다.' using errcode = '22023';
    end if;

    if p_reservation_date = v_today_seoul and v_start_time < date_trunc('minute', v_now_seoul)::time then
      raise exception '%~ 시간대는 이미 시작되어 예약할 수 없습니다.', to_char(v_start_time, 'HH24:MI') using errcode = '22023';
    end if;
  end loop;

  foreach v_start_time in array v_sorted_times loop
    v_lock_key := abs(hashtext(p_reservation_date::text || ':' || v_start_time::text))::bigint;
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  foreach v_start_time in array v_sorted_times loop
    select count(*) into v_existing_slot_count
    from public.reservations
    where reservation_date = p_reservation_date
      and start_time = v_start_time
      and status = 'active';

    if v_existing_slot_count > 0 then
      raise exception '%~% 시간대는 이미 다른 예약이 있어 추가할 수 없습니다.',
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
      btrim(p_name),
      btrim(p_department),
      btrim(p_student_number),
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

revoke all on function public.create_reservations_admin_bulk(date, time[], text, text, text, integer) from public;
grant execute on function public.create_reservations_admin_bulk(date, time[], text, text, text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;