-- Per-consultant monthly sales targets (bookings + deliveries) for the KIA Sales Performance page.
-- Actuals are read from kia_sales_report; this table only holds the targets. Additive, non-destructive.
-- Safe to run on production after `npm run db:backup`.

CREATE TABLE IF NOT EXISTS kia_sales_targets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_code      text NOT NULL,
  consultant_name  text NOT NULL,
  year             integer NOT NULL,
  month            integer NOT NULL, -- 1..12
  booking_target   integer NOT NULL DEFAULT 0,
  delivery_target  integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kia_sales_targets_unique_idx
  ON kia_sales_targets (dealer_code, consultant_name, year, month);
