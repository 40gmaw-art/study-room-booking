begin;

alter table public.reservations
  add column if not exists created_by_admin boolean not null default false;

update public.reservations as reservation
set created_by_admin = true
from public.profiles as profile
where profile.id = reservation.user_id
  and profile.role = 'admin'
  and reservation.created_by_admin = false;

create or replace function public.set_reservation_admin_origin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.created_by_admin := public.is_admin_user();
  return new;
end;
$$;

revoke all on function public.set_reservation_admin_origin() from public;
grant execute on function public.set_reservation_admin_origin() to authenticated;

drop trigger if exists reservations_set_admin_origin on public.reservations;
create trigger reservations_set_admin_origin
before insert on public.reservations
for each row execute function public.set_reservation_admin_origin();

notify pgrst, 'reload schema';

commit;