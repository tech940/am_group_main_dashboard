-- 0062 — Second lock on the LocoNav tracking tables (owner-approved, 2026-09-11).
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
-- ⚠️ Requires 0057, 0058 and 0060.
--
-- ── Why ─────────────────────────────────────────────────────────────────────────────────────
-- 0057 and 0058 revoked only `anon` and `PUBLIC`. Supabase's default privileges hand `authenticated` full
-- DML on every new table, and every signed-in browser tab holds an `authenticated` JWT that PostgREST
-- accepts. Row-level security (on, no policies) was the ONLY control — and on 2026-09-11
-- demo_gate_pass_trips was found with RLS switched OFF, i.e. any signed-in session could have read every
-- drive's route. 0060 already revokes `authenticated` on its own two tables; this brings the older four in
-- line. The app connects as `postgres` (owner, BYPASSRLS) and never reads these through Supabase, so
-- nothing in the app changes.
--
-- The tracker link history (demo_vehicle_tracker_events) refuses UPDATE and DELETE since 0060, but a
-- TRUNCATE fires no row trigger and would wipe it silently. A statement-level trigger closes that.

BEGIN;

REVOKE ALL ON public.demo_vehicle_trackers  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.demo_vehicle_positions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.loconav_sync_state     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.demo_gate_pass_trips   FROM anon, authenticated, PUBLIC;

-- Reuses 0060's function: it raises for whatever TG_OP fired it.
CREATE OR REPLACE TRIGGER demo_vehicle_tracker_events_no_truncate
  BEFORE TRUNCATE ON public.demo_vehicle_tracker_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.demo_vehicle_tracker_events_append_only();

COMMIT;

-- Verification (run separately):
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND table_name IN ('demo_vehicle_trackers', 'demo_vehicle_positions', 'loconav_sync_state', 'demo_gate_pass_trips')
--    AND grantee IN ('anon', 'authenticated', 'PUBLIC');                                              -- ZERO rows
-- SELECT tgname FROM pg_trigger WHERE tgname = 'demo_vehicle_tracker_events_no_truncate';           -- one row
