-- Evidence-based PostgreSQL fixes from the 2026-06-14 performance audit.
--
-- Supabase SQL editor / pooled clients: run this file as-is (no CONCURRENTLY).
-- For zero-downtime on a busy production DB, use instead:
--   scripts/postgres-performance-audit-fixes-concurrent.sql
-- and execute each statement separately in psql (autocommit, not inside BEGIN/COMMIT).

-- pg_stat_statements: 2,125 calls, 30.3 ms mean. The current report_type
-- index reads every row for that type and filters dealer and period afterward.
-- EXPLAIN ANALYZE observed 3,660 rows removed by filter for one request.
CREATE INDEX IF NOT EXISTS am_platinum_operation_period_lookup_idx
  ON am_platinum_operation_wise_analysis_report (
    (UPPER(TRIM(source_dealer_code::text))),
    report_type,
    report_period_start,
    (COALESCE(report_period_end, report_period_start))
  );

-- Dealer-scoped freshness and coverage checks otherwise normalize the dealer
-- expression for every row and cannot use the plain source_dealer_code index.
CREATE INDEX IF NOT EXISTS am_platinum_ro_billing_dealer_date_idx
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

-- These duplicate unique indexes enforce the same row_hash constraint twice.
-- Keep the automatically named constraint-backed indexes and remove only the
-- redundant manually-created copies.
DROP INDEX IF EXISTS idx_am_platinum_ro_billing_report_row_hash;
DROP INDEX IF EXISTS idx_am_platinum_repair_order_list_row_hash;
DROP INDEX IF EXISTS idx_am_platinum_operation_wise_analysis_report_row_hash;
DROP INDEX IF EXISTS idx_am_platinum_service_appointment_row_hash;
DROP INDEX IF EXISTS idx_am_platinum_call_center_complaints_row_hash;
DROP INDEX IF EXISTS idx_hyundai_warranty_claim_list_row_hash;
DROP INDEX IF EXISTS idx_hyundai_warranty_claim_ytp_row_hash;

ANALYZE am_platinum_operation_wise_analysis_report;
ANALYZE am_platinum_ro_billing_report;
