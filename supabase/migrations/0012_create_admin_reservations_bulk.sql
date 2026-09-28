begin;

-- Create all slots for one admin booking in one transaction so the existing
-- reservation grouping can display the range as one booking.
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
  v_sorted_times time[];
  v_reservation public.reservations%rowtype;
  v_start_time time;
  v_index integer;
begin
  if not public.is_admin_user() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

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
    select *
      into v_reservation
    from public.create_reservation(
      p_reservation_date,
      v_start_time,
      p_name,
      p_department,
      p_student_number,
      p_participant_count
    );
    return next v_reservation;
  end loop;

  return;
end;
$$;

revoke all on function public.create_reservations_admin_bulk(date, time[], text, text, text, integer) from public;
grant execute on function public.create_reservations_admin_bulk(date, time[], text, text, text, integer) to authenticated;

commit;
