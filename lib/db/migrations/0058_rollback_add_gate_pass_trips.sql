-- ROLLBACK of 0058 — trip reconciliation for the Demo Car GatePass fleet.
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- This drops every reconciled trip: the provider's distance, route and alerts for each returned
-- demo drive. Some of it is NOT recoverable — LocoNav prunes history, so a window that has aged out
-- cannot be re-fetched at any price. The odometer figures survive on demo_gate_passes; the GPS
-- account of the same journey does not.
--
-- EXPORT FIRST. From psql on the direct/session port (5432), not the pooler:
--
--   \copy (SELECT * FROM public.demo_gate_pass_trips ORDER BY pass_no) TO 'demo_gate_pass_trips.csv' WITH CSV HEADER
--
-- ⚠️ Also revert the code, or the reconcile sweep and the pass detail will 42P01: lib/loconav/trips.ts,
-- the reconciliation block in app/api/gate-pass/tracking/sync/route.ts, and demoGatePassTrips in
-- lib/db/schema.ts.

BEGIN;

DROP TABLE IF EXISTS public.demo_gate_pass_trips;

COMMIT;

-- Verification (run separately) — must return ZERO rows:
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'demo_gate_pass_trips';
