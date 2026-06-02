-- Demo vehicle operational details storage.
-- Used by Demo Cars List to store tracker/service/price/status details per VIN.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.demo_vehicle_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_key text NOT NULL UNIQUE,
  vin text,
  tracker_status text CHECK (
    tracker_status IS NULL OR tracker_status IN ('installed', 'not_installed')
  ),
  service_date date,
  current_reading_kms numeric(12, 0),
  on_road_price numeric(14, 2),
  vehicle_status text CHECK (
    vehicle_status IS NULL OR vehicle_status IN ('active', 'sold')
  ),
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_vehicle_details_vehicle_key_idx
  ON public.demo_vehicle_details (vehicle_key);

CREATE INDEX IF NOT EXISTS demo_vehicle_details_status_idx
  ON public.demo_vehicle_details (vehicle_status);

CREATE INDEX IF NOT EXISTS demo_vehicle_details_tracker_status_idx
  ON public.demo_vehicle_details (tracker_status);
