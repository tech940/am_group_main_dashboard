-- ROLLBACK of 0057 — LocoNav telematics for the Demo Car GatePass fleet.
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- This drops the VIN -> LocoNav vehicle mapping. That mapping is not free to rebuild: it is derived
-- by paging the provider's whole fleet and matching on chassisNumber, and any row a human pinned by
-- hand (matched_by = 'manual') is NOT recoverable from the provider at all — it exists only here.
--
-- EXPORT FIRST. Run these from psql on the direct/session port (5432), not the pooler:
--
--   \copy (SELECT * FROM public.demo_vehicle_trackers  ORDER BY vin) TO 'demo_vehicle_trackers.csv'  WITH CSV HEADER
--   \copy (SELECT * FROM public.demo_vehicle_positions ORDER BY vin) TO 'demo_vehicle_positions.csv' WITH CSV HEADER
--   \copy (SELECT * FROM public.loconav_sync_state)                  TO 'loconav_sync_state.csv'     WITH CSV HEADER
--
-- Positions are disposable (re-fetched on the next sync). The tracker mapping is not.
--
-- ⚠️ Also revert the code, or the fleet endpoint will 42P01 on every request: lib/loconav/**,
-- app/api/gate-pass/tracking/**, the tracking block in lib/gate-pass/fleet.ts, and the two table
-- definitions in lib/db/schema.ts.

BEGIN;

DROP TABLE IF EXISTS public.demo_vehicle_positions;
DROP TABLE IF EXISTS public.demo_vehicle_trackers;
DROP TABLE IF EXISTS public.loconav_sync_state;

COMMIT;

-- Verification (run separately) — must return ZERO rows:
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('demo_vehicle_trackers','demo_vehicle_positions','loconav_sync_state');
