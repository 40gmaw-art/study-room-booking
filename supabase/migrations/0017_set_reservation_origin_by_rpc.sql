begin;

-- Keep the existing booking validation and capacity checks, but make the
-- RPC used by each screen authoritative for created_by_admin. The legacy
-- insert trigger classifies by profile role, which is not the same as the
-- screen that initiated the booking.
alter function public.create_reservations_bulk(date, time[], text, text, text, integer)
  rename to create_reservations_bulk_with_role_origin;

revoke all on function public.create_reservations_bulk_with_role_origin(date, time[], text, text, text, integer)
  from public, anon, authenticated;

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
  v_reservation public.reservations%rowtype;
begin
  for v_reservation in
    select *
    from public.create_reservations_bulk_with_role_origin(
      p_reservation_date,
      p_start_times,
      p_name,
      p_department,
      p_student_number,
      p_participant_count
    )
  loop
    update public.reservations
    set created_by_admin = false
    where id = v_reservation.id
    returning * into v_reservation;

    return next v_reservation;
  end loop;

  return;
end;
$$;

revoke all on function public.create_reservations_bulk(date, time[], text, text, text, integer) from public;
grant execute on function public.create_reservations_bulk(date, time[], text, text, text, integer) to authenticated;

alter function public.create_reservations_admin_bulk(date, time[], text, text, text, integer)
  rename to create_reservations_admin_bulk_with_role_origin;

revoke all on function public.create_reservations_admin_bulk_with_role_origin(date, time[], text, text, text, integer)
  from public, anon, authenticated;

create function public.create_reservations_admin_bulk(
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
  v_reservation public.reservations%rowtype;
begin
  if not public.is_admin_user() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  for v_reservation in
    select *
    from public.create_reservations_admin_bulk_with_role_origin(
      p_reservation_date,
      p_start_times,
      p_name,
      p_department,
      p_student_number,
      p_participant_count
    )
  loop
    update public.reservations
    set created_by_admin = true
    where id = v_reservation.id
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