-- ROLLBACK of 0062 — second lock on the LocoNav tracking tables.
--
-- This removes ONLY the TRUNCATE guard on demo_vehicle_tracker_events.
--
-- ⚠️ It deliberately does NOT re-grant `authenticated`. Re-granting would reopen exactly the exposure 0062
-- closed (every signed-in browser session able to query these tables whenever RLS is off), and nothing in
-- the app needs that grant — the app connects as `postgres`. If a grant is ever genuinely required, write
-- a new, reviewed migration for the specific privilege, never a blanket GRANT ALL.

BEGIN;

DROP TRIGGER IF EXISTS demo_vehicle_tracker_events_no_truncate ON public.demo_vehicle_tracker_events;

COMMIT;

-- Verification (run separately) — must return ZERO rows:
-- SELECT tgname FROM pg_trigger WHERE tgname = 'demo_vehicle_tracker_events_no_truncate';
