-- Business Excellence relational table performance indexes.
-- Safe to run repeatedly. Run as standalone SQL because CONCURRENTLY cannot run inside a transaction block.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_idx
  ON ro_billing_report (bill_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_work_type_idx
  ON ro_billing_report (bill_date, work_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_service_type_idx
  ON ro_billing_report (bill_date, service_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_service_advisor_idx
  ON ro_billing_report (bill_date, service_advisor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_technician_idx
  ON ro_billing_report (bill_date, technician);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_model_idx
  ON ro_billing_report (bill_date, model);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_bill_type_idx
  ON ro_billing_report (bill_date, bill_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_bill_status_idx
  ON ro_billing_report (bill_date, bill_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_vehicle_reg_no_idx
  ON ro_billing_report (bill_date, vehicle_reg_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_vin_idx
  ON ro_billing_report (bill_date, vin);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_date_dealer_code_idx
  ON ro_billing_report (bill_date, dealer_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_bill_no_idx
  ON ro_billing_report (bill_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_ro_no_idx
  ON ro_billing_report (ro_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ro_billing_report_uploaded_at_idx
  ON ro_billing_report (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS open_ro_yearly_uploaded_at_idx
  ON open_ro_yearly (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_ro_date
  ON open_ro_yearly (ro_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_status
  ON open_ro_yearly (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_work_type
  ON open_ro_yearly (work_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_service_adv
  ON open_ro_yearly (service_adv);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_new_status
  ON open_ro_yearly (new_r_o_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_ro_sub_status
  ON open_ro_yearly (ro_sub_status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_ro_no
  ON open_ro_yearly (r_o_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ew_report_uploaded_at_idx
  ON ew_report (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS mcp_report_uploaded_at_idx
  ON mcp_report (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS rsa_report_uploaded_at_idx
  ON rsa_report (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS psf_yearly_uploaded_at_idx
  ON psf_yearly (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS adv_wise_lubricants_vas_uploaded_at_idx
  ON adv_wise_lubricants_vas (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_call_center_complaints_uploaded_at_idx
  ON kia_call_center_complaints (uploaded_at);
