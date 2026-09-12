-- Rollback 0065
BEGIN;

ALTER TABLE public.demo_gate_passes
  DROP COLUMN IF EXISTS fuel_slip_path,
  DROP COLUMN IF EXISTS pump_start_path,
  DROP COLUMN IF EXISTS pump_stop_path,
  DROP COLUMN IF EXISTS fuel_amount,
  DROP COLUMN IF EXISTS fuel_litres,
  DROP COLUMN IF EXISTS fuel_docs_uploaded_at,
  DROP COLUMN IF EXISTS fuel_docs_uploaded_by;

COMMIT;
