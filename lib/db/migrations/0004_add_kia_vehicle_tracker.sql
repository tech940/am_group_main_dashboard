-- Vehicle Tracker for the KIA service floor.
-- Logs a vehicle going out and returning, with an AI-verified, timestamped camera photo.
-- Run this after taking a backup (destructive DDL is blocked in the app; apply manually).

CREATE TABLE IF NOT EXISTS kia_vehicle_tracker (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  entry_date       date NOT NULL,
  vehicle_out_at   timestamptz NOT NULL,
  vehicle_in_at    timestamptz,
  status           text NOT NULL DEFAULT 'out',   -- 'out' | 'returned'
  duration_minutes integer,
  out_photo_url    text NOT NULL,
  out_photo_path   text,
  in_photo_url     text,
  in_photo_path    text,
  dealer_code      text,
  notes            text,
  created_by       uuid REFERENCES users(id),
  updated_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kia_vehicle_tracker_status ON kia_vehicle_tracker (status);
CREATE INDEX IF NOT EXISTS idx_kia_vehicle_tracker_entry_date ON kia_vehicle_tracker (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_kia_vehicle_tracker_dealer ON kia_vehicle_tracker (dealer_code);
