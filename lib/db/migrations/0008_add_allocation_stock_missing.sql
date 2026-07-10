-- Retain allotted vehicles and flag them "sold" when their VIN disappears from the DMS stock feed
-- (kia_stock_management). The allocation row already snapshots the full vehicle (vehicle_snapshot),
-- so these columns only add per-allocation stock-presence tracking. Additive, non-destructive.
-- Safe to run on production after `npm run db:backup`.

ALTER TABLE kia_vehicle_allocations ADD COLUMN IF NOT EXISTS stock_last_seen_at timestamptz;
ALTER TABLE kia_vehicle_allocations ADD COLUMN IF NOT EXISTS stock_missing_at   timestamptz;
ALTER TABLE kia_vehicle_allocations ADD COLUMN IF NOT EXISTS stock_status       text; -- NULL = normal/in-stock, 'sold' = gone from DMS

CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_active_missing_idx
  ON kia_vehicle_allocations (released_at, stock_missing_at);
