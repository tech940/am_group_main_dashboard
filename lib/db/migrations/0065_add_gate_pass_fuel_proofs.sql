-- 0065 — Fuel proof documents for Demo Car GatePass (Purpose == 'Fuel filling')
--
-- ── What this adds ────────────────────────────────────────────────────────────────────────────
-- When a demo car leaves the showroom for fuel filling, the driver must capture:
--   1. Physical Fuel Slip (printed receipt photo / doc)
--   2. Pump Start 0.00 (photo showing pump dispenser before fueling at 0.00)
--   3. Pump Stop Amount (photo showing pump dispenser after fueling with amount and volume)
--
-- Plus optional fuel amount in ₹ and quantity in litres.
--
-- ── Columns on demo_gate_passes ───────────────────────────────────────────────────────────────
--   fuel_slip_path         — object path in private 'demo-gate-pass' bucket
--   pump_start_path        — object path in private 'demo-gate-pass' bucket
--   pump_stop_path         — object path in private 'demo-gate-pass' bucket
--   fuel_amount            — receipt total in ₹
--   fuel_litres            — quantity in litres
--   fuel_docs_uploaded_at  — timestamp when driver/staff recorded proofs
--   fuel_docs_uploaded_by  — user who uploaded proofs
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

ALTER TABLE public.demo_gate_passes
  ADD COLUMN IF NOT EXISTS fuel_slip_path        text,
  ADD COLUMN IF NOT EXISTS pump_start_path       text,
  ADD COLUMN IF NOT EXISTS pump_stop_path        text,
  ADD COLUMN IF NOT EXISTS fuel_amount           numeric(12, 2),
  ADD COLUMN IF NOT EXISTS fuel_litres           numeric(10, 2),
  ADD COLUMN IF NOT EXISTS fuel_docs_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS fuel_docs_uploaded_by uuid REFERENCES public.users(id);

COMMIT;
