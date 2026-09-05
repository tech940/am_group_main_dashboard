-- Complete rollback for 0053_one_live_gate_pass_per_vehicle.sql.
--
-- Drops the index only. No table, column or row is touched and no data is lost.
--
-- Note this REMOVES the database guarantee that a demo car is out on at most one pass. The
-- application check in lib/gate-pass/server.ts still refuses at create time, but under concurrent
-- requests two passes can then both reach 'out'.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

DROP INDEX IF EXISTS public.demo_gate_passes_one_out_per_vehicle_idx;

-- Verify — expect 0.
-- SELECT COUNT(*) AS index_remaining FROM pg_indexes
--  WHERE indexname = 'demo_gate_passes_one_out_per_vehicle_idx';
