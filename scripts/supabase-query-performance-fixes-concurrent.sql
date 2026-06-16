-- Zero-downtime variant for psql CLI only.
-- CONCURRENTLY cannot run inside a transaction (Supabase SQL editor wraps in BEGIN/COMMIT).
--
-- Run one statement at a time, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/supabase-query-performance-fixes-concurrent.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_yearly_status_date
  ON open_ro_yearly (ro_date)
  WHERE lower(coalesce(status, '')) = 'open';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_yearly_vin_norm
  ON open_ro_yearly (upper(trim(vin)))
  WHERE vin IS NOT NULL AND trim(vin) <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_yearly_reg_norm
  ON open_ro_yearly (upper(trim(reg_no)))
  WHERE reg_no IS NOT NULL AND trim(reg_no) <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_dealer_norm
  ON ro_billing_report (
    upper(trim(coalesce(nullif(dealer_code, ''), nullif(main_dealer_code, ''))))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_vin_norm
  ON ro_billing_report (upper(trim(vin)))
  WHERE vin IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_reg_norm
  ON ro_billing_report (upper(trim(vehicle_reg_no)))
  WHERE vehicle_reg_no IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_warranty_claim_dealer_norm
  ON hyundai_warranty_claim_list (upper(trim(source_dealer_code)));

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_repair_order_list_row_hash
  ON hyundai_repair_order_list (row_hash);

ANALYZE adv_wise_lubricants_vas;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_ro_billing_bill_date
  ON hyundai_ro_billing_report (bill_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_ro_billing_bill_date_dealer
  ON hyundai_ro_billing_report (
    bill_date,
    upper(trim(coalesce(nullif(dealer_code, ''), nullif(main_dealer_code, ''))))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_repair_order_open_date
  ON hyundai_repair_order_list (r_o_date)
  WHERE lower(coalesce(r_o_status, '')) = 'open';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_repair_order_dealer_norm
  ON hyundai_repair_order_list (upper(trim(coalesce(dealer, ''))));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_complaints_complaint_date
  ON hyundai_call_center_complaints (complaint_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hyundai_ew_report_reg_date
  ON hyundai_ew_report (reg_date)
  WHERE lower(trim(coalesce(department::text, ''))) = 'service';
