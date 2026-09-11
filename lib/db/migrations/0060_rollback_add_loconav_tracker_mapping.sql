-- ROLLBACK of 0060 — LocoNav tracker mapping (the Trackers screen).
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- demo_vehicle_tracker_events is the ONLY record of who linked which tracker to which demo car, and when.
-- It cannot be rebuilt from LocoNav or from anywhere else. loconav_provider_vehicles is disposable — the
-- next sync lists the fleet again.
--
-- ⚠️ This does NOT undo the links themselves. Those are demo_vehicle_trackers rows (matched_by = 'manual',
-- from 0057) and the fleet board keeps drawing positions from them. Export and delete them separately if
-- the intent is to undo the linking, not just the screen.
--
-- EXPORT FIRST. Run these from psql on the direct/session port (5432), not the pooler:
--
--   \copy (SELECT * FROM public.demo_vehicle_tracker_events ORDER BY created_at)         TO 'demo_vehicle_tracker_events.csv' WITH CSV HEADER
--   \copy (SELECT * FROM public.loconav_provider_vehicles ORDER BY provider_vehicle_uuid) TO 'loconav_provider_vehicles.csv'  WITH CSV HEADER
--   \copy (SELECT * FROM public.demo_vehicle_trackers WHERE matched_by = 'manual' ORDER BY vin) TO 'manual_tracker_links.csv' WITH CSV HEADER
--
-- ⚠️ Also revert the code, or the sync and the Trackers screen fail on every request:
-- lib/loconav/mappings.ts, app/api/gate-pass/tracking/mappings/**, features/gate-pass/trackers-panel.tsx,
-- the provider snapshot writes in lib/loconav/sync.ts, and the two table definitions in lib/db/schema.ts.

BEGIN;

-- Dropping the table drops its trigger; the function is then unreferenced.
DROP TABLE IF EXISTS public.demo_vehicle_tracker_events;
DROP FUNCTION IF EXISTS public.demo_vehicle_tracker_events_append_only();
DROP TABLE IF EXISTS public.loconav_provider_vehicles;

COMMIT;

-- Verification (run separately) — must return ZERO rows:
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('loconav_provider_vehicles', 'demo_vehicle_tracker_events');
