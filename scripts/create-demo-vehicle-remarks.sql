-- Demo Job Cards remarks storage.
-- Run with:
--   psql "$DATABASE_URL" -f scripts/create-demo-vehicle-remarks.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.demo_vehicle_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL,
  remark text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS demo_vehicle_remarks_vin_created_idx
  ON public.demo_vehicle_remarks (vin, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS demo_vehicle_remarks_created_by_idx
  ON public.demo_vehicle_remarks (created_by);

CREATE INDEX IF NOT EXISTS ro_billing_report_demo_vehicle_tracker_idx
  ON public.ro_billing_report (work_type, vin, vehicle_reg_no, bill_date DESC)
  WHERE work_type = 'Test Drive/CC Maintenance';

CREATE OR REPLACE FUNCTION public.set_demo_vehicle_remarks_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS demo_vehicle_remarks_updated_at_trigger ON public.demo_vehicle_remarks;

CREATE TRIGGER demo_vehicle_remarks_updated_at_trigger
BEFORE UPDATE ON public.demo_vehicle_remarks
FOR EACH ROW
EXECUTE FUNCTION public.set_demo_vehicle_remarks_updated_at();
