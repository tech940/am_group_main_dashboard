-- Zero-downtime variant for psql CLI only.
-- CONCURRENTLY cannot run inside a transaction (Supabase SQL editor wraps in BEGIN/COMMIT).
--
-- Run one statement at a time, e.g.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres-performance-audit-fixes-concurrent.sql
-- or paste each block separately with autocommit enabled.

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_operation_period_lookup_idx
  ON am_platinum_operation_wise_analysis_report (
    (UPPER(TRIM(source_dealer_code::text))),
    report_type,
    report_period_start,
    (COALESCE(report_period_end, report_period_start))
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_ro_billing_dealer_date_idx
  ON am_platinum_ro_billing_report (
    (
      CASE
        WHEN COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
        ) = 'N6824' THEN 'N6250'
        ELSE COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
        )
      END
    ),
    bill_date,
    uploaded_at DESC
  )
  WHERE LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%';

DROP INDEX CONCURRENTLY IF EXISTS idx_am_platinum_ro_billing_report_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_am_platinum_repair_order_list_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_am_platinum_operation_wise_analysis_report_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_am_platinum_service_appointment_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_am_platinum_call_center_complaints_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_hyundai_warranty_claim_list_row_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_hyundai_warranty_claim_ytp_row_hash;

ANALYZE am_platinum_operation_wise_analysis_report;
ANALYZE am_platinum_ro_billing_report;
