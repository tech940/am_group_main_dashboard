-- Dashboard performance pass for Business Excellence and Purchase Orders.
-- Run this directly in Postgres/Supabase SQL editor after cron/import tables exist.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

-- Business Excellence: RO Billing filters, comparisons, trends, and intelligence reports.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date
  ON ro_billing_report (bill_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_work_type
  ON ro_billing_report (bill_date, work_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_service_type
  ON ro_billing_report (bill_date, service_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_advisor
  ON ro_billing_report (bill_date, service_advisor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_technician
  ON ro_billing_report (bill_date, technician);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_model
  ON ro_billing_report (bill_date, model);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_date_status_type
  ON ro_billing_report (bill_date, bill_status, bill_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_bill_no
  ON ro_billing_report (bill_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_ro_no
  ON ro_billing_report (ro_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_vehicle_reg_no
  ON ro_billing_report (vehicle_reg_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_vin
  ON ro_billing_report (vin);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_uploaded_at
  ON ro_billing_report (uploaded_at);

-- Purchase Orders: default today/all pagination, workflow tabs, stage queues, and spending view.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_created_at
  ON purchase_orders (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_status_created_at
  ON purchase_orders (status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_stage_created_at
  ON purchase_orders (current_stage, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_brand_status_created_at
  ON purchase_orders (brand, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_created_by_created_at
  ON purchase_orders (created_by, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_assigned_to_created_at
  ON purchase_orders (assigned_to, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_spend_date
  ON purchase_orders ((COALESCE(received_date_time, completed_at, created_at)) DESC)
  WHERE status IN ('awaiting_accounts', 'completed');

-- Optional precomputed daily summary for sub-second Business Excellence analytics.
-- Refresh this after every cron import:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY ro_billing_daily_summary;
CREATE MATERIALIZED VIEW IF NOT EXISTS ro_billing_daily_summary AS
SELECT
  bill_date,
  COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
  COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
  COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS service_advisor,
  COALESCE(NULLIF(technician, ''), 'Unspecified') AS technician,
  COALESCE(NULLIF(model, ''), 'Unspecified') AS model,
  COALESCE(NULLIF(bill_type, ''), 'Unspecified') AS bill_type,
  COALESCE(NULLIF(bill_status, ''), 'Unspecified') AS bill_status,
  COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS load_count,
  SUM(COALESCE(labour_amt, 0))::numeric AS labour_amount,
  SUM(COALESCE(part_amt, 0))::numeric AS part_amount,
  SUM(COALESCE(total_amt, 0))::numeric AS total_amount,
  AVG(NULLIF(avg_rating, 0))::numeric AS avg_rating,
  MAX(uploaded_at) AS uploaded_at
FROM ro_billing_report
WHERE bill_date IS NOT NULL
GROUP BY
  bill_date,
  COALESCE(NULLIF(work_type, ''), 'Unspecified'),
  COALESCE(NULLIF(service_type, ''), 'Unspecified'),
  COALESCE(NULLIF(service_advisor, ''), 'Unspecified'),
  COALESCE(NULLIF(technician, ''), 'Unspecified'),
  COALESCE(NULLIF(model, ''), 'Unspecified'),
  COALESCE(NULLIF(bill_type, ''), 'Unspecified'),
  COALESCE(NULLIF(bill_status, ''), 'Unspecified');

CREATE UNIQUE INDEX IF NOT EXISTS idx_ro_billing_daily_summary_unique
  ON ro_billing_daily_summary (
    bill_date,
    work_type,
    service_type,
    service_advisor,
    technician,
    model,
    bill_type,
    bill_status
  );

CREATE INDEX IF NOT EXISTS idx_ro_billing_daily_summary_date
  ON ro_billing_daily_summary (bill_date);
