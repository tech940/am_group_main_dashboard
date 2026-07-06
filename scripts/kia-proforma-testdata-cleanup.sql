-- ============================================================================
-- KIA Proforma module — FULL test-data wipe.
--
-- ⚠️ DESTRUCTIVE & IRREVERSIBLE. Take a backup first:  npm run db:backup
--
-- This clears the entire KIA Proforma workflow (bookings, generated proformas,
-- allotments, transfers, and the workflow activity/audit log). It does NOT touch
-- real reference/inventory data:
--   * kia_stock_management / kia_stock_report  (real vehicle inventory)
--   * kia_proforma_lookup_options              (imported price master)
--   * kia_stock_local_statuses                 (stock bbnd/retail markers)
--   * users / admin_audit_logs                 (accounts & admin audit)
--
-- Deletes run in foreign-key-safe order inside one transaction.
-- ============================================================================

BEGIN;

DELETE FROM kia_booking_activity;      -- workflow audit log (child of bookings)
DELETE FROM kia_vehicle_allocations;   -- allotments (child of bookings)
DELETE FROM kia_vehicle_transfers;     -- transfers (child of bookings)
DELETE FROM kia_bookings;              -- bookings (references proformas + finance orders)
DELETE FROM kia_proformas;             -- all generated proformas

COMMIT;

-- Optional: restart the booking-number sequence so new bookings start clean.
-- ALTER SEQUENCE public.kia_booking_number_seq RESTART WITH 1;
