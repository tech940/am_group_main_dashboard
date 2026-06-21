-- Hyundai Business Excellence parity indexes.
-- Safe to run repeatedly after the Hyundai source tables are present.

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_active_date_dealer_idx
  ON hyundai_ro_billing_report (
    bill_date,
    UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''))))
  )
  WHERE LOWER(TRIM(COALESCE(bill_type, ''))) NOT LIKE '%cancel%';

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_invoice_dedup_idx
  ON hyundai_ro_billing_report (
    bill_date,
    bill_no,
    r_o_no,
    uploaded_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_ro_idx
  ON hyundai_ro_billing_report (r_o_no, bill_date, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS hyundai_repair_order_open_dealer_date_idx
  ON hyundai_repair_order_list (
    UPPER(TRIM(COALESCE(dealer, ''))),
    r_o_date,
    uploaded_at DESC
  )
  WHERE LOWER(TRIM(COALESCE(r_o_status, ''))) = 'open';

CREATE INDEX IF NOT EXISTS hyundai_operation_period_dealer_idx
  ON hyundai_operation_wise_analysis_report (
    report_period_start,
    report_period_end,
    UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, '')))),
    uploaded_at DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_operation_row_hash_idx
  ON hyundai_operation_wise_analysis_report (row_hash, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS hyundai_complaints_business_date_idx
  ON hyundai_call_center_complaints (
    (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)),
    UPPER(TRIM(COALESCE(source_dealer_code, ''))),
    uploaded_at DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_ew_service_date_dealer_idx
  ON hyundai_ew_report (reg_date, UPPER(TRIM(COALESCE(dlr_no, ''))), uploaded_at DESC)
  WHERE LOWER(TRIM(COALESCE(department, ''))) = 'service';
