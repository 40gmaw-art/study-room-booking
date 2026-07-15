-- lib/booking-actions.ts's adminToggleReservationStatusAction and
-- adminDeleteReservationAction write to public.reservations directly via
-- PostgREST (.update()/.delete()), not through a security-definer RPC.
-- schema.sql only ever granted SELECT on this table to `authenticated`, so
-- those two actions could not have worked for anyone (including a real
-- admin) — Postgres checks table-level GRANTs before RLS policies run.
--
-- This is safe to add: the existing "admin_all_reservations" RLS policy
-- (for all using (is_admin_user()) with check (is_admin_user())) still gates
-- every row-level insert/update/delete to admins only. A non-admin session
-- gets this new GRANT too, but RLS denies the actual operation because
-- is_admin_user() is false for them — there is no self-service
-- insert/update/delete policy on this table for regular students.
--
-- Safe to re-run.

grant insert, update, delete on public.reservations to authenticated;

NOTIFY pgrst, 'reload schema';
