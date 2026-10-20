-- RULE FOR EVERY MIGRATION FROM HERE ON: any migration that creates a
-- table, view, materialized view or function in the public schema must
-- include its own GRANTs. From 2026-10-30 Supabase no longer grants Data
-- API access (supabase-js / PostgREST / GraphQL) to new public objects
-- automatically, so a new object without grants is invisible to the app
-- in new projects, preview branches and `supabase db reset`.
--
-- Pattern to copy:
--   grant select, insert, update, delete on table public.<t> to authenticated;
--   grant all privileges on table public.<t> to service_role;
--   revoke execute on function public.<f>(<args>) from public, anon;
--   grant execute on function public.<f>(<args>) to authenticated, service_role;
--
-- anon gets nothing: the proxy redirects logged-out users to /login before
-- any data is read, and the login page only calls Supabase Auth.
--
-- This migration backfills grants for everything created in 0001-0010.
-- Existing production tables kept their automatic grants, so re-granting
-- here is a no-op there and only matters for fresh environments.

-- Tables. RLS stays on and every policy still scopes rows to the caller.
grant select, insert, update, delete
  on table public.categories,
           public.entries,
           public.user_settings,
           public.periods,
           public.entry_categories
  to authenticated;

grant all privileges
  on table public.categories,
           public.entries,
           public.user_settings,
           public.periods,
           public.entry_categories
  to service_role;

-- Functions. Postgres grants EXECUTE to PUBLIC by default, so take that
-- away and hand it only to the roles that should call these RPCs. All
-- three are security invoker, so RLS applies inside them.
revoke execute on function public.entries_net_before(date, date) from public, anon;
revoke execute on function public.delete_category_reassigning(uuid, uuid) from public, anon;
revoke execute on function public.insert_entries_with_categories(jsonb) from public, anon;

grant execute on function public.entries_net_before(date, date)
  to authenticated, service_role;
grant execute on function public.delete_category_reassigning(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.insert_entries_with_categories(jsonb)
  to authenticated, service_role;
