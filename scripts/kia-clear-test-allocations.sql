-- ============================================================================
-- Remove the KIA test-allocation footprint created while testing the Bookings
-- section. This clears the 'retail' local-status marks (vehicles allotted +
-- payment-confirmed during testing) so those vehicles return to AVAILABLE stock
-- in the Stock Report, plus the allocation records themselves.
--
-- ⚠️ DESTRUCTIVE. Back up first (Supabase keeps automatic backups).
-- Wrapped in a transaction — review the preview counts, keep COMMIT to apply.
--
-- After this runs, the Stock Report available count goes 75 -> 81.
-- (The remaining gap to 85 is 4 vehicles with genuine DMS statuses —
--  Allocated / From Other Dealer / Invoice — which the available-stock view
--  correctly excludes; they are NOT test data.)
-- ============================================================================

BEGIN;

-- Preview what will be removed:
SELECT 'retail stock marks' AS item, count(*) AS rows FROM kia_stock_local_statuses WHERE local_status = 'retail'
UNION ALL SELECT 'vehicle allocations', count(*) FROM kia_vehicle_allocations;

-- 1) Un-retail the vehicles allotted/sold during testing (returns them to stock).
DELETE FROM kia_stock_local_statuses WHERE local_status = 'retail';

-- 2) Remove the test allocation records.
DELETE FROM kia_vehicle_allocations;

COMMIT;
