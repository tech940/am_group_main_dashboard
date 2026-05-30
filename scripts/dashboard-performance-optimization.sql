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

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_perf_branch_date
  ON ro_billing_report (bill_date, dealer_code, main_dealer_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_perf_advisor_date
  ON ro_billing_report (bill_date, service_advisor, model, service_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_report_perf_vehicle_date
  ON ro_billing_report (COALESCE(NULLIF(vin, ''), NULLIF(vehicle_reg_no, '')), bill_date);

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

-- Versioned deduplicated summary used by the RO Billing analysis API.
-- It keeps the API away from repeated COUNT(DISTINCT ...) scans on the raw report.
-- Refresh this after every cron import:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY ro_billing_daily_summary_v2;
CREATE MATERIALIZED VIEW IF NOT EXISTS ro_billing_daily_summary_v2 AS
WITH normalized AS (
  SELECT
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
    bill_date::date AS bill_date,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
    COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS service_advisor,
    COALESCE(NULLIF(technician, ''), 'Unspecified') AS technician,
    COALESCE(NULLIF(model, ''), 'Unspecified') AS model,
    COALESCE(NULLIF(bill_type, ''), 'Unspecified') AS bill_type,
    COALESCE(NULLIF(bill_status, ''), 'Unspecified') AS bill_status,
    COALESCE(labour_amt, 0)::numeric AS labour_amt,
    COALESCE(part_amt, 0)::numeric AS part_amt,
    COALESCE(total_amt, 0)::numeric AS total_amt,
    NULLIF(avg_rating, 0)::numeric AS avg_rating,
    uploaded_at
  FROM ro_billing_report
  WHERE bill_date IS NOT NULL
),
dedup AS (
  SELECT
    bill_key,
    bill_date,
    work_type,
    service_type,
    service_advisor,
    technician,
    model,
    bill_type,
    bill_status,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
    AVG(avg_rating) FILTER (WHERE avg_rating IS NOT NULL) AS avg_rating,
    MAX(uploaded_at) AS uploaded_at
  FROM normalized
  GROUP BY
    bill_key,
    bill_date,
    work_type,
    service_type,
    service_advisor,
    technician,
    model,
    bill_type,
    bill_status
)
SELECT
  bill_date,
  work_type,
  service_type,
  service_advisor,
  technician,
  model,
  bill_type,
  bill_status,
  COUNT(*)::int AS load_count,
  SUM(labour_amt)::numeric AS labour_amount,
  SUM(part_amt)::numeric AS part_amount,
  SUM(total_amt)::numeric AS total_amount,
  AVG(avg_rating) FILTER (WHERE avg_rating IS NOT NULL) AS avg_rating,
  MAX(uploaded_at) AS uploaded_at
FROM dedup
GROUP BY
  bill_date,
  work_type,
  service_type,
  service_advisor,
  technician,
  model,
  bill_type,
  bill_status;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ro_billing_daily_summary_v2_unique
  ON ro_billing_daily_summary_v2 (
    bill_date,
    work_type,
    service_type,
    service_advisor,
    technician,
    model,
    bill_type,
    bill_status
  );

CREATE INDEX IF NOT EXISTS idx_ro_billing_daily_summary_v2_date
  ON ro_billing_daily_summary_v2 (bill_date);

CREATE INDEX IF NOT EXISTS idx_ro_billing_daily_summary_v2_work_type_date
  ON ro_billing_daily_summary_v2 (work_type, bill_date);

-- Workshop Performance: multi-table dashboard indexes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_bill_date
  ON ro_billing_report (bill_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_service_type
  ON ro_billing_report (service_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_work_type
  ON ro_billing_report (work_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_service_advisor
  ON ro_billing_report (service_advisor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_vin
  ON ro_billing_report (vin);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_ro_no
  ON ro_billing_report (ro_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_bill_no
  ON ro_billing_report (bill_no);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operation_wise_uploaded_at
  ON operation_wise_analysis_report (uploaded_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operation_wise_report_month
  ON operation_wise_analysis_report (report_month);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operation_wise_op_part_code
  ON operation_wise_analysis_report (op_part_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operation_wise_report_type
  ON operation_wise_analysis_report (report_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ew_reg_date
  ON ew_report (reg_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ew_employee_name
  ON ew_report (employee_name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ew_vin
  ON ew_report (vin);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_purchase_date
  ON mcp_report (package_purchase_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_employee
  ON mcp_report (employee_name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_vin
  ON mcp_report (vin);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rsa_invoice_date
  ON rsa_report (invoice_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rsa_advisor
  ON rsa_report (selling_advisor);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rsa_vin
  ON rsa_report (vin_chasis_no);

-- Optional Workshop Performance materialized summary.
-- Refresh this after every cron import:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_summary_v2;
CREATE MATERIALIZED VIEW IF NOT EXISTS workshop_performance_summary_v2 AS
WITH ro_base AS (
  SELECT
    bill_date::date AS report_date,
    COALESCE(NULLIF(work_type, ''), NULLIF(service_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
    COALESCE(labour_amt, 0)::numeric AS labour_amt,
    COALESCE(part_amt, 0)::numeric AS part_amt,
    COALESCE(total_amt, 0)::numeric AS total_amt,
    GREATEST(
      COALESCE(dis_amt, 0)::numeric,
      COALESCE(total_disc, 0)::numeric,
      COALESCE(NULLIF(regexp_replace(labour_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0),
      COALESCE(NULLIF(regexp_replace(part_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)
    ) AS discount_amount
  FROM ro_billing_report
  WHERE bill_date IS NOT NULL
),
ro_dedup AS (
  SELECT
    report_date,
    service_type,
    jc_key,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
    MAX(discount_amount) AS discount_amount
  FROM ro_base
  GROUP BY report_date, service_type, jc_key
)
SELECT
  report_date,
  service_type,
  COUNT(*)::int AS total_jc,
  SUM(labour_amt)::numeric AS labour_amount,
  SUM(part_amt)::numeric AS part_amount,
  SUM(total_amt)::numeric AS total_amount,
  SUM(discount_amount)::numeric AS discount_amount,
  MAX(now()) AS refreshed_at
FROM ro_dedup
GROUP BY report_date, service_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_performance_summary_v2_unique
  ON workshop_performance_summary_v2 (report_date, service_type);

CREATE INDEX IF NOT EXISTS idx_workshop_performance_summary_v2_date
  ON workshop_performance_summary_v2 (report_date);

-- Faster Workshop Performance API source.
-- This keeps one pre-deduped row per job card/service/advisor/date so the API can
-- aggregate tables, KPI cards, daily trend, and advisor lists without repeatedly
-- scanning and de-duplicating ro_billing_report.
-- Refresh this after every cron import:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;
CREATE MATERIALIZED VIEW IF NOT EXISTS workshop_performance_jc_summary_v1 AS
WITH normalized AS (
  SELECT
    bill_date::date AS report_date,
    COALESCE(NULLIF(work_type, ''), NULLIF(service_type, ''), 'Unspecified') AS group_type,
    COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS service_advisor,
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
    COALESCE(labour_amt, 0)::numeric AS labour_amt,
    COALESCE(part_amt, 0)::numeric AS part_amt,
    COALESCE(total_amt, 0)::numeric AS total_amt,
    GREATEST(
      COALESCE(dis_amt, 0)::numeric,
      COALESCE(total_disc, 0)::numeric,
      COALESCE(NULLIF(regexp_replace(labour_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0),
      COALESCE(NULLIF(regexp_replace(part_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)
    ) AS discount_amount
  FROM ro_billing_report
  WHERE bill_date IS NOT NULL
),
dedup AS (
  SELECT
    report_date,
    group_type,
    service_type,
    service_advisor,
    jc_key,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amount,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amount,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amount,
    MAX(discount_amount) AS discount_amount,
    MAX(now()) AS refreshed_at
  FROM normalized
  GROUP BY report_date, group_type, service_type, service_advisor, jc_key
)
SELECT * FROM dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_performance_jc_summary_v1_unique
  ON workshop_performance_jc_summary_v1 (report_date, group_type, service_type, service_advisor, jc_key);

CREATE INDEX IF NOT EXISTS idx_workshop_performance_jc_summary_v1_date
  ON workshop_performance_jc_summary_v1 (report_date);

CREATE INDEX IF NOT EXISTS idx_workshop_performance_jc_summary_v1_service_date
  ON workshop_performance_jc_summary_v1 (group_type, service_type, report_date);

CREATE INDEX IF NOT EXISTS idx_workshop_performance_jc_summary_v1_advisor_date
  ON workshop_performance_jc_summary_v1 (service_advisor, report_date);

-- Preclassified monthly VAS / WA / WB summary for Workshop Performance.
-- Refresh this after every cron import:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;
CREATE MATERIALIZED VIEW IF NOT EXISTS workshop_operation_addon_summary_v1 AS
WITH operation_rows AS (
  SELECT DISTINCT
    date_trunc('month', report_month::date)::date AS report_month,
    report_type,
    op_part_code,
    op_part_desc,
    dealer_code,
    dealer_name,
    COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
    GREATEST(
      ABS(COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(sp2ib_seltos_1_5_petrol_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(sp2ic_seltos_1_4_petrol_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(sp2id_seltos_1_5_diesel_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(carnival_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(qy1ib_sonet_1_5_diesel_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(qy1ic_sonet_1_0_gasoline_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(qy1id_sonet_1_2_gasoline_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(ky1ia_carens_1_5_gasoline_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(ky1ib_carens_1_5_diesel_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)),
      ABS(COALESCE(NULLIF(regexp_replace(ky1ic_carens_1_4_gasoline_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0))
    ) AS operation_count,
    LOWER(COALESCE(op_part_code, '')) AS operation_code,
    LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) AS description
  FROM operation_wise_analysis_report
  WHERE report_month IS NOT NULL
),
classified AS (
  SELECT
    *,
    (
      operation_code ~ '(^|[^a-z])wa([^a-z]|$)'
        OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'
    ) AS is_wa,
    (
      operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
        OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'
    ) AS is_wb,
    (
      LOWER(COALESCE(report_type, '')) = 'operation'
        AND (
          operation_code ~ '(^|[^a-z])vas([^a-z]|$)'
            OR description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
            OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
            OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
            OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
        )
    ) AS is_vas
  FROM operation_rows
)
SELECT
  report_month,
  COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::numeric AS vas_amount,
  COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::int AS wa_count,
  COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::numeric AS wa_amount,
  COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::int AS wb_count,
  COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::numeric AS wb_amount,
  MAX(now()) AS refreshed_at
FROM classified
GROUP BY report_month;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_operation_addon_summary_v1_unique
  ON workshop_operation_addon_summary_v1 (report_month);
