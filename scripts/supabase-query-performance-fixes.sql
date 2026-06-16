-- Supabase query performance remediation.
-- Run indexes first (low risk), then security script.
--
-- Non-goals (platform overhead — do not "fix"):
--   - realtime.list_changes (Supabase Realtime internal)
--   - PostgREST schema introspection (pg_timezone_names, pg_class metadata)
--   - Dashboard queries (table_privileges, pg_available_extensions, index_advisor)
--
-- CONCURRENTLY cannot run inside a transaction (Supabase SQL editor wraps in BEGIN/COMMIT).
-- For zero-downtime production, run scripts/supabase-query-performance-fixes-concurrent.sql
-- via psql with autocommit, one statement at a time.

-- ============================================================================
-- 2.2 Kia open RO + ro_billing_report dealer/VIN/reg join
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_open_ro_yearly_status_date
  ON open_ro_yearly (ro_date)
  WHERE lower(coalesce(status, '')) = 'open';

CREATE INDEX IF NOT EXISTS idx_open_ro_yearly_vin_norm
  ON open_ro_yearly (upper(trim(vin)))
  WHERE vin IS NOT NULL AND trim(vin) <> '';

CREATE INDEX IF NOT EXISTS idx_open_ro_yearly_reg_norm
  ON open_ro_yearly (upper(trim(reg_no)))
  WHERE reg_no IS NOT NULL AND trim(reg_no) <> '';

CREATE INDEX IF NOT EXISTS idx_ro_billing_dealer_norm
  ON ro_billing_report (
    upper(trim(coalesce(nullif(dealer_code, ''), nullif(main_dealer_code, ''))))
  );

CREATE INDEX IF NOT EXISTS idx_ro_billing_vin_norm
  ON ro_billing_report (upper(trim(vin)))
  WHERE vin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ro_billing_reg_norm
  ON ro_billing_report (upper(trim(vehicle_reg_no)))
  WHERE vehicle_reg_no IS NOT NULL;

-- ============================================================================
-- 2.3 Hyundai warranty claims dealer filter
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_hyundai_warranty_claim_dealer_norm
  ON hyundai_warranty_claim_list (upper(trim(source_dealer_code)));

-- ============================================================================
-- 2.4 Hyundai repair order bulk upsert — conflict target on row_hash
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_hyundai_repair_order_list_row_hash
  ON hyundai_repair_order_list (row_hash);

-- ============================================================================
-- 2.5 Materialized view refresh (workshop_operation_addon_summary_v1)
-- Keep post-import refresh off-peak; see dashboard-performance-optimization.sql
-- ============================================================================

-- ============================================================================
-- 2.6 adv_wise_lubricants_vas — refresh stats after large imports
-- ============================================================================

ANALYZE adv_wise_lubricants_vas;

-- ============================================================================
-- 2.7 Hyundai Business Excellence overview (hyundai_* tables)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_hyundai_ro_billing_bill_date
  ON hyundai_ro_billing_report (bill_date);

CREATE INDEX IF NOT EXISTS idx_hyundai_ro_billing_bill_date_dealer
  ON hyundai_ro_billing_report (
    bill_date,
    upper(trim(coalesce(nullif(dealer_code, ''), nullif(main_dealer_code, ''))))
  );

CREATE INDEX IF NOT EXISTS idx_hyundai_repair_order_open_date
  ON hyundai_repair_order_list (r_o_date)
  WHERE lower(coalesce(r_o_status, '')) = 'open';

CREATE INDEX IF NOT EXISTS idx_hyundai_repair_order_dealer_norm
  ON hyundai_repair_order_list (upper(trim(coalesce(dealer, ''))));

CREATE INDEX IF NOT EXISTS idx_hyundai_complaints_complaint_date
  ON hyundai_call_center_complaints (complaint_date);

CREATE INDEX IF NOT EXISTS idx_hyundai_ew_report_reg_date
  ON hyundai_ew_report (reg_date)
  WHERE lower(trim(coalesce(department::text, ''))) = 'service';
