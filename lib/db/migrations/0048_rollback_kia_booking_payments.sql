-- Rollback 0048.
--
-- ⚠️ This DESTROYS every recorded part payment. kia_booking_payments is the only record of that
-- money in this app — kia_receipt_report is the DMS's own feed and will not contain the app's rows.
-- Export it before running:
--   COPY (SELECT * FROM kia_booking_payments) TO STDOUT WITH CSV HEADER;
--
-- Order matters: the ledger references allocations, so it goes first.

DROP TABLE IF EXISTS kia_booking_payments;

DROP INDEX IF EXISTS kia_vehicle_allocations_secured_idx;
ALTER TABLE kia_vehicle_allocations DROP COLUMN IF EXISTS payment_secured_at;

ALTER TABLE kia_bookings DROP CONSTRAINT IF EXISTS kia_bookings_amount_received_check;
ALTER TABLE kia_bookings DROP COLUMN IF EXISTS amount_received;

ANALYZE kia_bookings;
ANALYZE kia_vehicle_allocations;
