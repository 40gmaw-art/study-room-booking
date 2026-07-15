create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  department text,
  student_number text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_number text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  department text not null,
  student_number text not null,
  reservation_date date not null,
  start_time time not null,
  status text not null default 'active' check (status in ('active','cancelled')),
  participant_count integer not null default 1 check (participant_count >= 1 and participant_count <= 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists reservations_user_date_idx on public.reservations (user_id, reservation_date, start_time);
create index if not exists reservations_date_idx on public.reservations (reservation_date, start_time, status);

create unique index if not exists reservations_unique_active_idx
on public.reservations (user_id, reservation_date, start_time)
where status = 'active';

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

create or replace function public.enforce_profile_role()
returns trigger
language plpgsql
as $$
declare
  v_current_user_id uuid := auth.uid();
  v_current_role text;
begin
  if TG_OP = 'INSERT' then
    if NEW.role is null then
      NEW.role := 'student';
    end if;

    if NEW.role not in ('student', 'admin') then
      raise exception '허용되지 않은 role 값입니다.' using errcode = '22023';
    end if;

    if NEW.role = 'admin' then
      if v_current_user_id is null then
        raise exception '관리자 권한으로 프로필을 생성할 수 없습니다.' using errcode = '42501';
      end if;

      select role into v_current_role
      from public.profiles
      where id = v_current_user_id;

      if coalesce(v_current_role, 'student') <> 'admin' then
        raise exception '일반 학생은 관리자 역할로 프로필을 생성할 수 없습니다.' using errcode = '42501';
      end if;
    end if;

    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.role is distinct from OLD.role then
      if v_current_user_id is null then
        raise exception '역할 변경 권한이 없습니다.' using errcode = '42501';
      end if;

      select role into v_current_role
      from public.profiles
      where id = v_current_user_id;

      if coalesce(v_current_role, 'student') <> 'admin' then
        raise exception '일반 학생은 role을 변경할 수 없습니다.' using errcode = '42501';
      end if;
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.handle_updated_at();

DROP TRIGGER IF EXISTS reservations_updated_at ON public.reservations;
create trigger reservations_updated_at
before update on public.reservations
for each row execute function public.handle_updated_at();

DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
create trigger profiles_role_guard
before insert or update on public.profiles
for each row execute function public.enforce_profile_role();

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
  select r.start_time, coalesce(sum(r.participant_count), 0)::bigint as active_count
  from public.reservations r
  where r.reservation_date = p_date and r.status = 'active'
  group by r.start_time
$$;

create or replace function public.validate_reservation_date(p_reservation_date date)
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

alter table public.profiles enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "reservations_self_select" on public.reservations;
create policy "reservations_self_select" on public.reservations
for select using (auth.uid() = user_id);

drop policy if exists "admin_all_profiles" on public.profiles;
create policy "admin_all_profiles" on public.profiles
for all using (public.is_admin_user()) with check (public.is_admin_user());

drop policy if exists "admin_all_reservations" on public.reservations;
create policy "admin_all_reservations" on public.reservations
for all using (public.is_admin_user()) with check (public.is_admin_user());

revoke all on public.profiles from public;
revoke all on public.reservations from public;
revoke all on function public.handle_updated_at() from public;
revoke all on function public.generate_reservation_number() from public;
revoke all on function public.is_admin_user() from public;
revoke all on function public.get_time_slot_counts(date) from public;
revoke all on function public.validate_reservation_date(date) from public;
revoke all on function public.create_reservation(date, time, text, text, text, integer) from public;
revoke all on function public.update_reservation_admin(uuid, date, time, text, text, text, integer) from public;
revoke all on function public.cancel_reservation(text) from public;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.reservations to authenticated;
grant execute on function public.create_reservation(date, time, text, text, text, integer) to authenticated;
grant execute on function public.update_reservation_admin(uuid, date, time, text, text, text, integer) to authenticated;
grant execute on function public.cancel_reservation(text) to authenticated;
grant execute on function public.get_time_slot_counts(date) to authenticated;
grant execute on function public.is_admin_user() to authenticated;

-- Bulk booking: reserve multiple time slots for one date in a single atomic
-- transaction, all sharing the SAME participant_count. See
-- supabase/migrations/0001_create_reservations_bulk.sql and
-- supabase/migrations/0006_add_participant_count.sql.
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

    if v_current_total + p_participant_count > 6 then
      raise exception '%~% 시간대는 현재 잔여 인원이 %명이므로 %명을 예약할 수 없습니다. 전체 예약이 취소되었습니다.',
        to_char(v_start_time, 'HH24:MI'),
        to_char(v_start_time + interval '1 hour', 'HH24:MI'),
        greatest(6 - v_current_total, 0),
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

revoke all on function public.create_reservations_bulk(date, time[], text, text, text, integer) from public;
grant execute on function public.create_reservations_bulk(date, time[], text, text, text, integer) to authenticated;

-- Admin-only hard delete of a single reservation row. See
-- supabase/migrations/0005_admin_delete_reservation.sql.
create or replace function public.admin_delete_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_reservation public.reservations%rowtype;
begin
  if not public.is_admin_user() then
    raise exception '관리자만 예약을 삭제할 수 있습니다.' using errcode = '42501';
  end if;

  select * into v_reservation
  from public.reservations
  where id = p_reservation_id
  limit 1;

  if not found then
    raise exception '이미 삭제되었거나 존재하지 않는 예약입니다.' using errcode = '22023';
  end if;

  delete from public.reservations where id = p_reservation_id;

  return v_reservation;
end;
$$;

revoke all on function public.admin_delete_reservation(uuid) from public;
grant execute on function public.admin_delete_reservation(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
