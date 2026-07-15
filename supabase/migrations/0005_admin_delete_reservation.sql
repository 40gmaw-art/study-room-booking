-- Adds public.admin_delete_reservation(uuid): a security-definer RPC that
-- lets an admin permanently delete a single reservation row, verifying
-- profiles.role === 'admin' (via public.is_admin_user()) INSIDE the
-- function itself -- not relying on the frontend hiding the delete button.
--
-- public.reservations.id is `uuid primary key default gen_random_uuid()`
-- (confirmed in supabase/schema.sql), so the parameter is typed uuid, not
-- guessed as bigint/text.
--
-- Does not touch any existing table, RLS policy, or row. Safe to re-run
-- (drops any pre-existing overload of this function first, then recreates).

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_delete_reservation'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end;
$$;

create function public.admin_delete_reservation(p_reservation_id uuid)
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

-- ────────────────────────────────────────────────────────────────────────
-- Verification (run separately, not part of the fix):
-- select p.proname, pg_get_function_identity_arguments(p.oid) as arg_types
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'admin_delete_reservation';
-- -- expect exactly 1 row: arg_types = 'p_reservation_id uuid'
-- ────────────────────────────────────────────────────────────────────────
