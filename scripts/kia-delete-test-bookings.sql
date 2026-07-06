-- ============================================================================
-- KIA — delete ALL test BOOKINGS and their dependent rows.
--
-- ⚠️ DESTRUCTIVE & IRREVERSIBLE. Take a backup first:  npm run db:backup
--
-- Removes every booking plus its children (activity log, allotments, transfers).
-- Does NOT delete generated proformas, price master, users, or real inventory.
-- If you also want to wipe proformas, use scripts/kia-proforma-testdata-cleanup.sql.
--
-- Runs in one transaction in FK-safe order. Review the preview counts, then keep
-- COMMIT (or switch to ROLLBACK to abort without changes).
-- ============================================================================

BEGIN;

-- Preview what will be removed:
SELECT 'kia_bookings'            AS table_name, count(*) AS rows FROM kia_bookings
UNION ALL SELECT 'kia_booking_activity',    count(*) FROM kia_booking_activity
UNION ALL SELECT 'kia_vehicle_allocations', count(*) FROM kia_vehicle_allocations
UNION ALL SELECT 'kia_vehicle_transfers',   count(*) FROM kia_vehicle_transfers;

-- Children first (FK order), then the bookings themselves.
DELETE FROM kia_booking_activity;      -- workflow / timeline audit (child of bookings)
DELETE FROM kia_vehicle_allocations;   -- VIN allotments (child of bookings)
DELETE FROM kia_vehicle_transfers;     -- inter-dealer transfers (child of bookings)
DELETE FROM kia_bookings;              -- all bookings

-- Optional cleanups for a fully fresh testing phase — uncomment as needed:

-- Clear the email delivery log rows tied to the deleted bookings:
-- DELETE FROM kia_email_logs WHERE booking_id IS NOT NULL;

-- Release the 'retail' stock markers written when payments were confirmed during
-- testing, so those VINs become allottable again (leaves genuine 'bbnd' marks):
-- DELETE FROM kia_stock_local_statuses WHERE local_status = 'retail';

-- Restart the booking-number sequence so new bookings start clean:
-- ALTER SEQUENCE public.kia_booking_number_seq RESTART WITH 1;

COMMIT;
