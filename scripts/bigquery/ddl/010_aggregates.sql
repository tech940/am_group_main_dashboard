-- Aggregate tables mirroring Postgres materialized views.

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates.ro_billing_daily_summary` (
  dealer_code STRING,
  bill_date DATE,
  deduped_jc INT64,
  labour NUMERIC,
  parts NUMERIC,
  revenue NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY bill_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates.workshop_performance_jc_summary` (
  dealer_code STRING,
  report_date DATE,
  invoices INT64,
  ro_count INT64,
  labour_amount NUMERIC,
  part_amount NUMERIC,
  total_amount NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates.vas_period_summary` (
  dealer_code STRING,
  period_start DATE,
  period_end DATE,
  period_rows INT64,
  source_rows INT64,
  vas_amount NUMERIC,
  uploaded_at TIMESTAMP,
  refreshed_at TIMESTAMP
)
PARTITION BY period_start
CLUSTER BY dealer_code, period_end;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates.open_ro_daily_summary` (
  dealer_code STRING,
  report_date DATE,
  advisor STRING,
  work_type STRING,
  open_ro INT64,
  refreshed_at TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.platinum_aggregates.complaints_daily_summary` (
  dealer_code STRING,
  report_date DATE,
  total INT64,
  open_count INT64,
  refreshed_at TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_aggregates.ro_billing_daily_summary` (
  dealer_code STRING,
  bill_date DATE,
  deduped_jc INT64,
  labour NUMERIC,
  parts NUMERIC,
  revenue NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY bill_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_aggregates.workshop_performance_jc_summary` (
  dealer_code STRING,
  report_date DATE,
  invoices INT64,
  ro_count INT64,
  labour_amount NUMERIC,
  part_amount NUMERIC,
  total_amount NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.kia_aggregates.workshop_operation_addon_summary` (
  dealer_code STRING,
  report_month DATE,
  wa_amount NUMERIC,
  wb_amount NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY report_month
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.hyundai_aggregates.workshop_performance_jc_summary` (
  dealer_code STRING,
  report_date DATE,
  invoices INT64,
  ro_count INT64,
  labour_amount NUMERIC,
  part_amount NUMERIC,
  total_amount NUMERIC,
  refreshed_at TIMESTAMP
)
PARTITION BY report_date
CLUSTER BY dealer_code;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.etl_metadata.sync_watermarks` (
  source_table STRING,
  destination_table STRING,
  last_uploaded_at TIMESTAMP,
  last_row_hash STRING,
  rows_synced INT64,
  batch_id STRING,
  synced_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.etl_metadata.validation_runs` (
  run_id STRING,
  mode STRING,
  table_name STRING,
  postgres_rows INT64,
  bigquery_rows INT64,
  postgres_metric NUMERIC,
  bigquery_metric NUMERIC,
  delta_pct FLOAT64,
  passed BOOL,
  details STRING,
  ran_at TIMESTAMP
);
