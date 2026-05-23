-- Business Excellence relational table performance indexes.
-- Safe to run repeatedly.

CREATE INDEX IF NOT EXISTS ro_billing_report_bill_date_idx
  ON ro_billing_report (bill_date);

CREATE INDEX IF NOT EXISTS ro_billing_report_bill_date_work_type_idx
  ON ro_billing_report (bill_date, work_type);

CREATE INDEX IF NOT EXISTS ro_billing_report_bill_date_service_advisor_idx
  ON ro_billing_report (bill_date, service_advisor);

CREATE INDEX IF NOT EXISTS ro_billing_report_bill_date_model_idx
  ON ro_billing_report (bill_date, model);

CREATE INDEX IF NOT EXISTS ro_billing_report_bill_no_idx
  ON ro_billing_report (bill_no);

CREATE INDEX IF NOT EXISTS ro_billing_report_ro_no_idx
  ON ro_billing_report (ro_no);

CREATE INDEX IF NOT EXISTS ro_billing_report_uploaded_at_idx
  ON ro_billing_report (uploaded_at);

CREATE INDEX IF NOT EXISTS open_ro_yearly_uploaded_at_idx
  ON open_ro_yearly (uploaded_at);

CREATE INDEX IF NOT EXISTS ew_report_uploaded_at_idx
  ON ew_report (uploaded_at);

CREATE INDEX IF NOT EXISTS mcp_report_uploaded_at_idx
  ON mcp_report (uploaded_at);

CREATE INDEX IF NOT EXISTS rsa_report_uploaded_at_idx
  ON rsa_report (uploaded_at);

CREATE INDEX IF NOT EXISTS psf_yearly_uploaded_at_idx
  ON psf_yearly (uploaded_at);

CREATE INDEX IF NOT EXISTS adv_wise_lubricants_vas_uploaded_at_idx
  ON adv_wise_lubricants_vas (uploaded_at);

CREATE INDEX IF NOT EXISTS kia_call_center_complaints_uploaded_at_idx
  ON kia_call_center_complaints (uploaded_at);
