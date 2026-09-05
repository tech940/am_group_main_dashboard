-- 0053 — a demo car can be out on only one gate pass at a time.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- 0051 and 0052 shipped with nothing stopping two passes being raised against the same VIN. Both
-- could be approved, both gated out, and the fleet view would then report a car as simultaneously
-- out twice — a state the physical world cannot be in. In practice the second person walks to a
-- parking bay and finds nothing there.
--
-- lib/gate-pass/server.ts now refuses at create time with a message naming who holds the car. This
-- index is the backstop underneath that check: the application produces the friendly error, the
-- database makes it unbypassable under concurrency. Same division of labour as
-- bank_sanction_limits_loan_key_idx in 0045.
--
-- ── Why PARTIAL, and only on 'out' ────────────────────────────────────────────────────────────
-- Only one status is a physical claim on the vehicle. A car that is 'returned' can obviously go out
-- again, so a plain unique index on vin would forbid a demo car ever being used twice.
--
-- 'approved' is deliberately NOT included. It is a soft hold — the car is still on the premises,
-- and a manager may legitimately approve a replacement pass while cancelling the first. Enforcing
-- that in the database would turn an ordinary correction into a constraint violation with no way
-- through; the application check covers it and can be overridden by cancelling.
--
-- ⚠️ If this fails with a unique-violation, the data ALREADY contains a double-out. Find it first —
-- do not drop the index to make the error go away:
--     SELECT vin, COUNT(*), ARRAY_AGG(pass_no)
--       FROM demo_gate_passes WHERE status = 'out' GROUP BY vin HAVING COUNT(*) > 1;
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

CREATE UNIQUE INDEX IF NOT EXISTS demo_gate_passes_one_out_per_vehicle_idx
  ON public.demo_gate_passes (vin)
  WHERE status = 'out';

-- Verify — expect 1.
-- SELECT COUNT(*) AS index_present FROM pg_indexes
--  WHERE tablename = 'demo_gate_passes'
--    AND indexname = 'demo_gate_passes_one_out_per_vehicle_idx';
