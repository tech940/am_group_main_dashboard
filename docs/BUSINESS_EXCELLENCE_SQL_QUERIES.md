# Business Excellence Dashboard SQL Queries

Last updated: 2026-05-28

This document maps the SQL currently used by the KIA Business Excellence dashboard. The application builds these queries with Drizzle `sql` template strings, so this document uses named placeholders such as `:startDate`, `:endDate`, `:limit`, `:offset`, and filter names instead of JavaScript template interpolation.

Source files:

- `app/api/brands/kia/business-excellence/route.ts`
- `app/api/brands/kia/business-excellence/overview/route.ts`
- `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts`
- `app/api/brands/kia/business-excellence/workshop-performance/route.ts`
- `app/api/brands/kia/business-excellence/open-ro/route.ts`
- `app/api/brands/kia/business-excellence/complaints/route.ts`
- `app/api/brands/kia/business-excellence/performance-intelligence/route.ts`
- `scripts/dashboard-performance-optimization.sql`

## Date Bases

| Area | Table | Date column |
| --- | --- | --- |
| RO Billing | `ro_billing_report` | `bill_date` |
| Workshop closed jobs | `ro_billing_report` or `workshop_performance_jc_summary_v1` | `bill_date` or `report_date` |
| Open RO | `open_ro_yearly` | `ro_date` |
| Complaints | `kia_call_center_complaints` | `complaint_date` |
| EW | `ew_report` | `reg_date` |
| MCP | `mcp_report` | `package_purchase_date` |
| RSA | `rsa_report` | `invoice_date` |
| Operation add-ons | `operation_wise_analysis_report` or `workshop_operation_addon_summary_v1` | `report_month` |

## Shared SQL Helpers

Numeric text cleanup:

```sql
COALESCE(NULLIF(regexp_replace(<column>::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)
```

Active RO Billing rows:

```sql
LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
```

Cancelled RO Billing rows:

```sql
LOWER(TRIM(COALESCE(bill_status::text, ''))) IN ('cancel', 'cancelled', 'canceled')
```

RO/job key:

```sql
COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text)
```

Open RO key:

```sql
COALESCE(NULLIF(r_o_no, ''), id::text)
```

Complaint key:

```sql
COALESCE(NULLIF(complaint_no, ''), id::text)
```

EW dedupe key:

```sql
COALESCE(
  NULLIF(TRIM(certi_no), ''),
  NULLIF(CONCAT_WS(
    '|',
    NULLIF(TRIM(vin), ''),
    NULLIF(TRIM(scheme_desc), ''),
    reg_date::text,
    COALESCE(kin_amt, 0)::text
  ), ''),
  id::text
)
```

RSA dedupe key:

```sql
COALESCE(
  NULLIF(TRIM(invoice_no), ''),
  CONCAT_WS(
    '|',
    NULLIF(TRIM(vin_chasis_no), ''),
    NULLIF(TRIM(policy_name), ''),
    invoice_date::text,
    COALESCE(total_amount, 0)::text
  ),
  id::text
)
```

## Metadata And Raw Rows API

Source: `app/api/brands/kia/business-excellence/route.ts`

Supported table metadata currently focuses on `ro_billing_report`.

Columns:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = :tableName
ORDER BY ordinal_position;
```

Projected RO Billing rows:

```sql
SELECT
  id,
  bill_date,
  bill_no,
  ro_no,
  vehicle_reg_no,
  vin,
  model,
  work_type,
  service_type,
  service_advisor,
  technician,
  bill_status,
  labour_amt,
  part_amt,
  total_amt,
  uploaded_at
FROM ro_billing_report
WHERE (:startDate IS NULL OR bill_date BETWEEN :startDate::date AND :endDate::date)
ORDER BY bill_date, id
LIMIT :limit OFFSET :offset;
```

Projected RO Billing row count:

```sql
SELECT COUNT(*)::int AS total
FROM ro_billing_report
WHERE (:startDate IS NULL OR bill_date BETWEEN :startDate::date AND :endDate::date);
```

RO Billing metadata:

```sql
SELECT
  COUNT(*)::int AS total_rows,
  MIN(bill_date) AS min_date,
  MAX(bill_date) AS max_date,
  MAX(uploaded_at) AS uploaded_at
FROM ro_billing_report;
```

## Business Excellence Overview

Source: `app/api/brands/kia/business-excellence/overview/route.ts`

Table existence:

```sql
SELECT to_regclass(:qualifiedTableName) IS NOT NULL AS exists;
```

Workshop summary usability:

```sql
SELECT
  MIN(report_date)::date <= :startDate::date
  AND MAX(report_date)::date >= :endDate::date AS usable
FROM workshop_performance_jc_summary_v1;
```

RO Billing base CTE:

```sql
WITH raw AS (
  SELECT
    bill_date::date AS report_date,
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
    CASE
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
        OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%'
        THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%'
        THEN 'Running Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%'
        THEN 'Free Service'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
        OR COALESCE(service_type, '') ~* '^[0-9]+K$'
        THEN 'Paid Service'
      ELSE 'Others'
    END AS service_category,
    COALESCE(NULLIF(regexp_replace(labour_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS labour_amt,
    COALESCE(NULLIF(regexp_replace(part_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS part_amt,
    COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS total_amt
  FROM ro_billing_report
  WHERE bill_date >= :startDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY jc_key
      ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC
    ) AS row_rank
  FROM raw
),
base AS (
  SELECT
    jc_key,
    (ARRAY_AGG(report_date ORDER BY row_rank ASC))[1] AS report_date,
    (ARRAY_AGG(advisor ORDER BY row_rank ASC))[1] AS advisor,
    (ARRAY_AGG(service_category ORDER BY row_rank ASC))[1] AS service_category,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
  FROM ranked
  GROUP BY jc_key
),
enriched AS (
  SELECT *, labour_amt + part_amt AS revenue
  FROM base
)
```

Overview RO KPIs:

```sql
<RO Billing base CTE>
SELECT
  COUNT(DISTINCT jc_key)::int AS total_jc,
  MIN(report_date)::text AS min_bill_date,
  MAX(report_date)::text AS max_bill_date,
  COALESCE(SUM(labour_amt), 0)::float AS labour,
  COALESCE(SUM(part_amt), 0)::float AS parts,
  COALESCE(SUM(revenue), 0)::float AS revenue,
  COALESCE(AVG(revenue), 0)::float AS avg_line_value
FROM enriched;
```

Overview RO daily trend:

```sql
<RO Billing base CTE>
SELECT
  report_date::text AS date,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(revenue), 0)::float AS revenue
FROM enriched
GROUP BY report_date
ORDER BY report_date ASC
LIMIT 45;
```

Overview RO service mix:

```sql
<RO Billing base CTE>
SELECT
  service_category,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(revenue), 0)::float AS revenue
FROM enriched
GROUP BY service_category
ORDER BY total_jc DESC, revenue DESC
LIMIT 6;
```

Overview advisor revenue:

```sql
<RO Billing base CTE>
SELECT
  advisor,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(revenue), 0)::float AS revenue
FROM enriched
GROUP BY advisor
ORDER BY revenue DESC, total_jc DESC
LIMIT 8;
```

Open RO base CTE used by overview:

```sql
WITH active AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
    COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
    ro_date,
    service_adv,
    work_type,
    service_type,
    status,
    COALESCE(revised_promise_date_time, promise_date_time) AS promise_date,
    uploaded_at
  FROM open_ro_yearly
  WHERE LOWER(COALESCE(status, '')) = 'open'
    AND ro_date >= :startDate::date
    AND ro_date < (:endDate::date + INTERVAL '1 day')
  ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
),
enriched AS (
  SELECT
    *,
    GREATEST((CURRENT_DATE - ro_date)::int, 0) AS aging_days,
    CASE
      WHEN (CURRENT_DATE - ro_date)::int <= 4 THEN '0-4D'
      WHEN (CURRENT_DATE - ro_date)::int <= 7 THEN '5-7D'
      WHEN (CURRENT_DATE - ro_date)::int <= 15 THEN '8-15D'
      ELSE '>15D'
    END AS aging_bucket,
    CASE
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
        OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%'
        THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%'
        THEN 'Running Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%'
        THEN 'Free Service'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
        OR COALESCE(service_type, '') ~* '^[0-9]+K$'
        THEN 'Paid Service'
      ELSE 'Others'
    END AS service_category,
    CASE
      WHEN promise_date IS NOT NULL AND CURRENT_DATE > promise_date THEN 'Delayed'
      ELSE 'On Track'
    END AS delay_status
  FROM active
)
```

Overview Open RO KPIs:

```sql
<Open RO base CTE>
SELECT
  COUNT(*)::int AS total_open_ro,
  MIN(ro_date)::text AS min_ro_date,
  MAX(ro_date)::text AS max_ro_date,
  COALESCE(AVG(aging_days), 0)::float AS avg_aging,
  COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15,
  COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed,
  COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accident_jobs
FROM enriched;
```

Overview Open RO chart queries:

```sql
<Open RO base CTE>
SELECT aging_bucket AS bucket, COUNT(*)::int AS count
FROM enriched
GROUP BY aging_bucket;

<Open RO base CTE>
SELECT
  COALESCE(NULLIF(service_adv, ''), 'Unspecified') AS advisor,
  COUNT(*)::int AS open_ro,
  COALESCE(AVG(aging_days), 0)::float AS avg_aging
FROM enriched
GROUP BY 1
ORDER BY open_ro DESC, avg_aging DESC
LIMIT 8;

<Open RO base CTE>
SELECT service_category, COUNT(*)::int AS count
FROM enriched
GROUP BY service_category
ORDER BY count DESC;
```

Complaint base CTE used by overview:

```sql
WITH latest AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
    *
  FROM kia_call_center_complaints
  WHERE complaint_date IS NOT NULL
  ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
),
enriched AS (
  SELECT
    complaint_no,
    complaint_date,
    close_date,
    resolving_date,
    dealer_name,
    dealer_code,
    vehicle_model,
    COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS sr_area,
    COALESCE(NULLIF(sr_sub_area, ''), 'Unspecified') AS sr_sub_area,
    CASE
      WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
      WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
      WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
      ELSE 'Open'
    END AS status_group,
    COALESCE(
      CASE
        WHEN close_date IS NOT NULL THEN GREATEST((close_date - complaint_date)::int, 0)
        WHEN resolving_date IS NOT NULL THEN GREATEST((resolving_date - complaint_date)::int, 0)
        ELSE NULL
      END,
      COALESCE(NULLIF(regexp_replace(pending_days::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)::int,
      GREATEST((CURRENT_DATE - complaint_date)::int, 0)
    ) AS resolution_days,
    CASE
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%part%' THEN 'Parts Delay'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%deliver%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%delay%' THEN 'Delay / Delivery'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%insurance%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%approval%' THEN 'Approval / Insurance'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%noise%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%rattl%' THEN 'Noise / Quality'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%accident%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%body%' THEN 'Bodyshop'
      ELSE COALESCE(NULLIF(sr_area, ''), 'General Service')
    END AS signal_area
  FROM latest
  WHERE complaint_date >= :startDate::date
    AND complaint_date < (:endDate::date + INTERVAL '1 day')
)
```

Overview complaint queries:

```sql
<Complaint base CTE>
SELECT
  COUNT(*)::int AS total,
  MIN(complaint_date)::text AS min_complaint_date,
  MAX(complaint_date)::text AS max_complaint_date,
  COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
  COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
  COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
  COALESCE(AVG(resolution_days), 0)::float AS avg_days
FROM enriched;

<Complaint base CTE>
SELECT
  signal_area AS name,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
  COALESCE(AVG(resolution_days), 0)::float AS avg_days
FROM enriched
GROUP BY signal_area
ORDER BY total DESC, open DESC
LIMIT 8;

<Complaint base CTE>
SELECT status_group AS status, COUNT(*)::int AS count
FROM enriched
GROUP BY status_group
ORDER BY count DESC;
```

EW count:

```sql
WITH dedup AS (
  SELECT DISTINCT ON (<EW dedupe key>)
    <EW dedupe key> AS ew_key,
    reg_date,
    uploaded_at,
    id
  FROM ew_report
  WHERE reg_date >= :startDate::date
    AND reg_date < (:endDate::date + INTERVAL '1 day')
    AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
  ORDER BY <EW dedupe key>, uploaded_at DESC NULLS LAST, id DESC
)
SELECT COUNT(*)::int AS count
FROM dedup;
```

MCP count:

```sql
SELECT COUNT(*)::int AS count
FROM mcp_report
WHERE package_purchase_date >= :startDate::date
  AND package_purchase_date < (:endDate::date + INTERVAL '1 day')
  AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service';
```

RSA count and amount:

```sql
WITH dedup AS (
  SELECT DISTINCT ON (<RSA dedupe key>)
    <RSA dedupe key> AS rsa_key,
    invoice_date,
    COALESCE(NULLIF(regexp_replace(total_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS total_amount,
    uploaded_at,
    id
  FROM rsa_report
  WHERE invoice_date >= :startDate::date
    AND invoice_date < (:endDate::date + INTERVAL '1 day')
  ORDER BY <RSA dedupe key>, uploaded_at DESC NULLS LAST, id DESC
)
SELECT
  COUNT(*)::int AS count,
  COALESCE(SUM(total_amount), 0)::float AS amount
FROM dedup;
```

Workshop snapshot from materialized JC summary:

```sql
SELECT
  COALESCE(NULLIF(group_type, ''), NULLIF(service_type, ''), 'Others') AS service_type,
  MIN(report_date)::text AS min_date,
  MAX(report_date)::text AS max_date,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
  COALESCE(SUM(part_amount), 0)::float AS part_amount
FROM workshop_performance_jc_summary_v1
WHERE report_date >= :startDate::date
  AND report_date < (:endDate::date + INTERVAL '1 day')
GROUP BY COALESCE(NULLIF(group_type, ''), NULLIF(service_type, ''), 'Others')
ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
LIMIT 8;
```

Workshop snapshot fallback from RO Billing:

```sql
WITH raw AS (
  SELECT
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
    bill_date::date AS report_date,
    CASE
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
        OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%' THEN 'Running Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%' THEN 'Free Service'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
        OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
      ELSE COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Others')
    END AS service_type,
    COALESCE(NULLIF(regexp_replace(labour_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS labour_amt,
    COALESCE(NULLIF(regexp_replace(part_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS part_amt
  FROM ro_billing_report
  WHERE bill_date >= :startDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
),
dedup AS (
  SELECT
    jc_key,
    (ARRAY_AGG(report_date ORDER BY report_date DESC))[1] AS report_date,
    (ARRAY_AGG(service_type ORDER BY ABS(labour_amt + part_amt) DESC))[1] AS service_type,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
  FROM raw
  GROUP BY jc_key
)
SELECT
  service_type,
  MIN(report_date)::text AS min_date,
  MAX(report_date)::text AS max_date,
  COUNT(*)::int AS total_jc,
  COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
  COALESCE(SUM(part_amt), 0)::float AS part_amount
FROM dedup
GROUP BY service_type
ORDER BY (COALESCE(SUM(labour_amt), 0) + COALESCE(SUM(part_amt), 0)) DESC
LIMIT 8;
```

Workshop VAS amount from monthly materialized view:

```sql
SELECT COALESCE(SUM(vas_amount), 0)::float AS vas_amount
FROM workshop_operation_addon_summary_v1
WHERE report_month >= date_trunc('month', :startDate::date)::date
  AND report_month <= date_trunc('month', :endDate::date)::date;
```

Workshop VAS fallback from operation report:

```sql
WITH operation_rows AS (
  SELECT
    ABS(COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)) AS amount,
    LOWER(COALESCE(op_part_code, '')) AS operation_code,
    LOWER(CONCAT_WS(' ', report_type, op_part_code, op_part_desc)) AS description
  FROM operation_wise_analysis_report
  WHERE report_month >= date_trunc('month', :startDate::date)::date
    AND report_month <= date_trunc('month', :endDate::date)::date
)
SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
FROM operation_rows
WHERE operation_code ~ '(^|[^a-z])vas([^a-z]|$)'
  OR description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
  OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
  OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)';
```

## RO Billing Analysis

Source: `app/api/brands/kia/business-excellence/ro-billing-analysis/route.ts`

Daily summary path:

```sql
SELECT
  bill_date,
  COALESCE(SUM(load_count), 0)::int AS load,
  COALESCE(SUM(labour_amount), 0)::float AS labour,
  COALESCE(SUM(part_amount), 0)::float AS parts
FROM ro_billing_daily_summary_v2
WHERE bill_date >= :lyStartDate::date
  AND bill_date < (:endDate::date + INTERVAL '1 day')
  AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
GROUP BY bill_date
ORDER BY bill_date;
```

Daily raw fallback:

```sql
WITH dedup AS (
  SELECT
    bill_key,
    bill_date,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
  FROM (
    SELECT
      COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
      bill_date::date AS bill_date,
      COALESCE(labour_amt, 0)::numeric AS labour_amt,
      COALESCE(part_amt, 0)::numeric AS part_amt
    FROM ro_billing_report
    WHERE bill_date >= :lyStartDate::date
      AND bill_date < (:endDate::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
  ) base
  GROUP BY bill_key, bill_date
)
SELECT
  bill_date,
  COUNT(DISTINCT bill_key)::int AS load,
  COALESCE(SUM(labour_amt), 0)::float AS labour,
  COALESCE(SUM(part_amt), 0)::float AS parts
FROM dedup
GROUP BY bill_date
ORDER BY bill_date;
```

Fiscal trend summary path:

```sql
WITH fiscal AS (
  SELECT
    CASE
      WHEN EXTRACT(MONTH FROM bill_date) >= 4 THEN EXTRACT(YEAR FROM bill_date)::int
      ELSE EXTRACT(YEAR FROM bill_date)::int - 1
    END AS fiscal_start_year,
    COALESCE(SUM(load_count), 0)::int AS load,
    COALESCE(SUM(labour_amount), 0)::float AS labour,
    COALESCE(SUM(part_amount), 0)::float AS parts
  FROM ro_billing_daily_summary_v2
  WHERE bill_date IS NOT NULL
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
  GROUP BY fiscal_start_year
)
SELECT
  ('FY ' || fiscal_start_year::text || '-' || RIGHT((fiscal_start_year + 1)::text, 2)) AS fy,
  load,
  labour,
  parts
FROM fiscal
ORDER BY fiscal_start_year DESC
LIMIT 5;
```

Work-type table summary path:

```sql
SELECT
  work_type,
  service_type,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :tdStart::date AND :tdEnd::date), 0)::int AS td_cy_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :mtdStart::date AND :mtdEnd::date), 0)::int AS mtd_cy_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :mtdLyStart::date AND :mtdLyEnd::date), 0)::int AS mtd_ly_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :qtdStart::date AND :qtdEnd::date), 0)::int AS qtd_cy_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :qtdLyStart::date AND :qtdLyEnd::date), 0)::int AS qtd_ly_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :ytdStart::date AND :ytdEnd::date), 0)::int AS ytd_cy_load,
  COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN :ytdLyStart::date AND :ytdLyEnd::date), 0)::int AS ytd_ly_load,
  COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN :tdStart::date AND :tdEnd::date), 0)::float AS td_cy_labour,
  COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN :mtdStart::date AND :mtdEnd::date), 0)::float AS mtd_cy_labour,
  COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN :mtdStart::date AND :mtdEnd::date), 0)::float AS mtd_cy_parts
FROM ro_billing_daily_summary_v2
WHERE bill_date >= :ytdLyStart::date
  AND bill_date < (:ytdEnd::date + INTERVAL '1 day')
  AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
GROUP BY work_type, service_type;
```

The raw fallback uses the same output columns, but first deduplicates by `work_type`, `service_type`, `bill_key`, and `bill_date` from `ro_billing_report`.

Analytics quality summary:

```sql
WITH base AS (
  SELECT
    bill_date::date AS bill_date,
    NULLIF(regexp_replace(COALESCE(avg_rating::text, ''), '[^0-9.-]', '', 'g'), '')::numeric AS rating,
    LOWER(TRIM(COALESCE(pick_drop::text, ''))) AS pick_drop_value
  FROM ro_billing_report
  WHERE bill_date >= :lyStartDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
)
SELECT
  COALESCE(AVG(rating) FILTER (WHERE bill_date BETWEEN :startDate::date AND :endDate::date AND rating > 0), 0)::float AS avg_rating,
  COALESCE(AVG(rating) FILTER (WHERE bill_date BETWEEN :lyStartDate::date AND :lyEndDate::date AND rating > 0), 0)::float AS avg_rating_ly,
  COALESCE(
    COUNT(*) FILTER (
      WHERE bill_date BETWEEN :startDate::date AND :endDate::date
        AND pick_drop_value NOT IN ('', '-', 'none', 'no', 'n/a', 'na')
    )::float / NULLIF(COUNT(*) FILTER (WHERE bill_date BETWEEN :startDate::date AND :endDate::date), 0) * 100,
    0
  )::float AS pick_drop_rate
FROM base;
```

Advisor leaderboard summary path:

```sql
WITH advisor_totals AS (
  SELECT
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS name,
    COALESCE(SUM(load_count), 0)::int AS load,
    COALESCE(SUM(labour_amount), 0)::float AS labour,
    COALESCE(SUM(part_amount), 0)::float AS parts,
    COALESCE(SUM(total_amount), 0)::float AS total_amount
  FROM ro_billing_daily_summary_v2
  WHERE bill_date >= :startDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
  GROUP BY name
),
ranked AS (
  SELECT
    name,
    load,
    labour,
    parts,
    CASE WHEN total_amount > 0 THEN total_amount ELSE labour + parts END AS revenue
  FROM advisor_totals
  WHERE name <> 'Unspecified'
),
totals AS (
  SELECT COALESCE(SUM(revenue), 0)::float AS total_revenue FROM ranked
)
SELECT
  ranked.name,
  ranked.load,
  ranked.labour,
  ranked.parts,
  ranked.revenue,
  CASE WHEN ranked.load > 0 THEN ranked.revenue / ranked.load ELSE 0 END::float AS average_billing,
  CASE WHEN totals.total_revenue > 0 THEN ranked.revenue / totals.total_revenue * 100 ELSE 0 END::float AS contribution
FROM ranked
CROSS JOIN totals
ORDER BY revenue DESC, load DESC
LIMIT 10;
```

Cancelled billing summary:

```sql
WITH cancelled AS (
  SELECT
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
    bill_no,
    ro_no,
    bill_date::date AS bill_date,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
    COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
    bill_status,
    COALESCE(labour_amt, 0)::numeric AS labour_amt,
    COALESCE(part_amt, 0)::numeric AS part_amt,
    COALESCE(total_amt, labour_amt + part_amt, 0)::numeric AS total_amt,
    uploaded_at,
    id
  FROM ro_billing_report
  WHERE bill_date >= :startDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) IN ('cancel', 'cancelled', 'canceled')
),
dedup AS (
  SELECT
    bill_key,
    (ARRAY_AGG(bill_no ORDER BY uploaded_at DESC NULLS LAST, id DESC))[1] AS bill_no,
    (ARRAY_AGG(ro_no ORDER BY uploaded_at DESC NULLS LAST, id DESC))[1] AS ro_no,
    (ARRAY_AGG(bill_date ORDER BY uploaded_at DESC NULLS LAST, id DESC))[1] AS bill_date,
    (ARRAY_AGG(work_type ORDER BY ABS(COALESCE(total_amt, labour_amt + part_amt, 0)) DESC))[1] AS work_type,
    (ARRAY_AGG(service_type ORDER BY ABS(COALESCE(total_amt, labour_amt + part_amt, 0)) DESC))[1] AS service_type,
    (ARRAY_AGG(advisor ORDER BY uploaded_at DESC NULLS LAST, id DESC))[1] AS advisor,
    (ARRAY_AGG(bill_status ORDER BY uploaded_at DESC NULLS LAST, id DESC))[1] AS bill_status,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
  FROM cancelled
  GROUP BY bill_key
)
SELECT *
FROM dedup
ORDER BY bill_date DESC NULLS LAST, bill_key
LIMIT 100;
```

## Workshop Performance

Source: `app/api/brands/kia/business-excellence/workshop-performance/route.ts`

Service summary using materialized JC summary:

```sql
SELECT
  group_type,
  service_type,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
  COALESCE(SUM(part_amount), 0)::float AS part_amount,
  COALESCE(SUM(total_amount), 0)::float AS total_amount,
  COALESCE(SUM(discount_amount), 0)::float AS discount_amount
FROM workshop_performance_jc_summary_v1
WHERE report_date >= :startDate::date
  AND report_date < (:endDate::date + INTERVAL '1 day')
GROUP BY group_type, service_type
ORDER BY group_type ASC, total_jc DESC, service_type ASC;
```

Service summary raw fallback:

```sql
WITH base AS (
  SELECT
    COALESCE(NULLIF(work_type, ''), NULLIF(service_type, ''), 'Unspecified') AS group_type,
    COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Unspecified') AS service_type,
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
  WHERE bill_date >= :startDate::date
    AND bill_date < (:endDate::date + INTERVAL '1 day')
),
dedup AS (
  SELECT
    group_type,
    service_type,
    jc_key,
    (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
    (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
    (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
    MAX(discount_amount) AS discount_amount
  FROM base
  GROUP BY group_type, service_type, jc_key
)
SELECT
  group_type,
  service_type,
  COUNT(*)::int AS total_jc,
  COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
  COALESCE(SUM(part_amt), 0)::float AS part_amount,
  COALESCE(SUM(total_amt), 0)::float AS total_amount,
  COALESCE(SUM(discount_amount), 0)::float AS discount_amount
FROM dedup
GROUP BY group_type, service_type
ORDER BY group_type ASC, total_jc DESC, service_type ASC;
```

Addon summary from materialized view:

```sql
SELECT
  'Others' AS service_type,
  COALESCE(SUM(vas_amount), 0)::float AS vas_amount,
  COALESCE(SUM(wa_count), 0)::int AS wa_count,
  COALESCE(SUM(wa_amount), 0)::float AS wa_amount,
  COALESCE(SUM(wb_count), 0)::int AS wb_count,
  COALESCE(SUM(wb_amount), 0)::float AS wb_amount
FROM workshop_operation_addon_summary_v1
WHERE report_month >= date_trunc('month', :startDate::date)::date
  AND report_month <= date_trunc('month', :endDate::date)::date;
```

Daily trend using summary:

```sql
SELECT
  report_date AS bill_date,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
  COALESCE(SUM(part_amount), 0)::float AS part_amount
FROM workshop_performance_jc_summary_v1
WHERE report_date >= :startDate::date
  AND report_date < (:endDate::date + INTERVAL '1 day')
GROUP BY report_date
ORDER BY report_date ASC;
```

Advisor summary using summary:

```sql
SELECT
  service_advisor AS advisor,
  COUNT(DISTINCT jc_key)::int AS total_jc,
  COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
  COALESCE(SUM(part_amount), 0)::float AS part_amount
FROM workshop_performance_jc_summary_v1
WHERE report_date >= :startDate::date
  AND report_date < (:endDate::date + INTERVAL '1 day')
GROUP BY service_advisor
ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
LIMIT 10;
```

Auxiliary EW/MCP/RSA queries are the same as the overview EW/MCP/RSA queries.

## Open RO Dashboard

Source: `app/api/brands/kia/business-excellence/open-ro/route.ts`

Open RO base CTE:

```sql
WITH active AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
    id,
    COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
    r_o_no,
    ro_date,
    reg_no,
    vin,
    model,
    work_type,
    service_type,
    customer_name,
    service_adv,
    main_technician,
    status,
    new_r_o_status,
    ro_sub_status,
    COALESCE(revised_promise_date_time, promise_date_time) AS promise_date,
    promise_date_time,
    revised_promise_date_time,
    mileage,
    insurance_company_name,
    estimate_amt,
    labour_amt,
    part_amt,
    total,
    delay_reason,
    ro_remaks,
    revisit_vehicle,
    re_open_count,
    task_description,
    uploaded_at
  FROM open_ro_yearly
  WHERE LOWER(COALESCE(status, '')) = 'open'
    AND (:startDate::date IS NULL OR ro_date >= :startDate::date)
    AND (:endDate::date IS NULL OR ro_date < (:endDate::date + INTERVAL '1 day'))
  ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
),
enriched AS (
  SELECT
    *,
    CASE WHEN ro_date IS NULL THEN 0 ELSE GREATEST((CURRENT_DATE - ro_date)::int, 0) END AS aging_days,
    CASE
      WHEN ro_date IS NULL THEN '0-4D'
      WHEN (CURRENT_DATE - ro_date)::int <= 4 THEN '0-4D'
      WHEN (CURRENT_DATE - ro_date)::int <= 7 THEN '5-7D'
      WHEN (CURRENT_DATE - ro_date)::int <= 15 THEN '8-15D'
      ELSE '>15D'
    END AS aging_bucket,
    CASE
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
        OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%' THEN 'Running Repair'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%' THEN 'Free Service'
      WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
        OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
      ELSE 'Others'
    END AS service_category,
    CASE
      WHEN COALESCE(revised_promise_date_time, promise_date_time) IS NOT NULL
        AND CURRENT_DATE > COALESCE(revised_promise_date_time, promise_date_time) THEN 'Delayed'
      ELSE 'On Track'
    END AS delay_status
  FROM active
),
filtered AS (
  SELECT *
  FROM enriched
  WHERE (:advisor::text IS NULL OR service_adv = :advisor)
    AND (:workType::text IS NULL OR service_category = :workType)
    AND (:agingBucket::text IS NULL OR aging_bucket = :agingBucket)
    AND (:insurance::text IS NULL OR insurance_company_name = :insurance)
)
```

Open RO payload queries:

```sql
<Open RO base CTE>
SELECT
  COUNT(*)::int AS total_open_ro,
  COALESCE(AVG(aging_days), 0)::float AS avg_aging,
  COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15_days,
  COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed_ro,
  COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accident_jobs,
  COUNT(*) FILTER (WHERE service_category = 'Running Repair')::int AS running_repairs
FROM filtered;

<Open RO base CTE>
SELECT
  service_category,
  COUNT(*)::int AS total_wip,
  COUNT(*) FILTER (WHERE aging_bucket = '0-4D')::int AS bucket_0_4,
  COUNT(*) FILTER (WHERE aging_bucket = '5-7D')::int AS bucket_5_7,
  COUNT(*) FILTER (WHERE aging_bucket = '8-15D')::int AS bucket_8_15,
  COUNT(*) FILTER (WHERE aging_bucket = '>15D')::int AS bucket_over_15,
  COALESCE(AVG(aging_days), 0)::float AS avg_days
FROM filtered
GROUP BY service_category
ORDER BY total_wip DESC;

<Open RO base CTE>
SELECT
  COALESCE(NULLIF(TRIM(delay_reason), ''), 'No Reason Specified') AS delay_reason,
  COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS acc_count,
  COUNT(*) FILTER (WHERE service_category <> 'Accidental Repair')::int AS mech_count,
  COUNT(*)::int AS total,
  COALESCE(AVG(aging_days), 0)::float AS avg_days
FROM filtered
GROUP BY COALESCE(NULLIF(TRIM(delay_reason), ''), 'No Reason Specified')
ORDER BY total DESC, avg_days DESC, delay_reason ASC
LIMIT 20;

<Open RO base CTE>
SELECT *
FROM filtered
ORDER BY aging_days DESC, promise_date ASC NULLS LAST, service_category ASC
LIMIT 1000;
```

## KIA Complaints Dashboard

Source: `app/api/brands/kia/business-excellence/complaints/route.ts`

Complaints base CTE:

```sql
WITH latest AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
    *
  FROM kia_call_center_complaints
  WHERE complaint_date IS NOT NULL
  ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
),
enriched AS (
  SELECT
    *,
    CASE
      WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
      WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
      WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
      ELSE 'Open'
    END AS status_group,
    COALESCE(
      CASE
        WHEN close_date IS NOT NULL THEN GREATEST((close_date - complaint_date)::int, 0)
        WHEN resolving_date IS NOT NULL THEN GREATEST((resolving_date - complaint_date)::int, 0)
        ELSE NULL
      END,
      COALESCE(NULLIF(regexp_replace(pending_days::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)::int,
      GREATEST((CURRENT_DATE - complaint_date)::int, 0)
    ) AS resolution_days,
    CASE
      WHEN COALESCE(close_date, resolving_date) IS NULL THEN GREATEST((CURRENT_DATE - complaint_date)::int, 0)
      ELSE 0
    END AS open_days,
    CASE
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%part%' THEN 'Parts Delay'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%deliver%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%delay%' THEN 'Delay / Delivery'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%insurance%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%approval%' THEN 'Approval / Insurance'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%noise%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%rattl%' THEN 'Noise / Quality'
      WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%accident%'
        OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%body%' THEN 'Bodyshop'
      ELSE COALESCE(NULLIF(sr_area, ''), 'General Service')
    END AS signal_area
  FROM latest
),
filtered AS (
  SELECT *
  FROM enriched
  WHERE (:startDate::date IS NULL OR complaint_date >= :startDate::date)
    AND (:endDate::date IS NULL OR complaint_date < (:endDate::date + INTERVAL '1 day'))
    AND (:status::text IS NULL OR status_group = :status)
    AND (:dealer::text IS NULL OR dealer_name = :dealer)
    AND (:area::text IS NULL OR COALESCE(NULLIF(sr_area, ''), 'Unspecified') = :area)
    AND (:model::text IS NULL OR COALESCE(NULLIF(vehicle_model, ''), 'Unspecified') = :model)
    AND (:source::text IS NULL OR COALESCE(NULLIF(complaint_sub_source, ''), 'Unspecified') = :source)
)
```

Complaints payload queries:

```sql
<Complaints base CTE>
SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
  COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
  COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
  COUNT(*) FILTER (WHERE signal_area IN ('Delay / Delivery', 'Parts Delay'))::int AS delay_related,
  COALESCE(AVG(resolution_days), 0)::float AS avg_resolution_days,
  COALESCE(MAX(resolution_days), 0)::int AS max_resolution_days
FROM filtered;

<Complaints base CTE>
SELECT
  COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS name,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
  COALESCE(AVG(resolution_days), 0)::float AS avg_days
FROM filtered
GROUP BY 1
ORDER BY total DESC, avg_days DESC
LIMIT 8;

<Complaints base CTE>
SELECT
  COALESCE(NULLIF(dealer_name, ''), 'Unspecified') AS dealer,
  COALESCE(NULLIF(dealer_code, ''), '-') AS dealer_code,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
  COALESCE(AVG(resolution_days), 0)::float AS avg_days,
  COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15
FROM filtered
GROUP BY 1, 2
ORDER BY total DESC, open DESC, avg_days DESC
LIMIT 8;

<Complaints base CTE>
SELECT *
FROM filtered
ORDER BY
  CASE WHEN status_group <> 'Closed' THEN 0 ELSE 1 END,
  resolution_days DESC,
  complaint_date DESC
LIMIT 150;
```

The complaints endpoint also builds monthly CY/LY trends, YTD comparisons, yearly summaries, and filter options from the same `latest` complaint CTE.

## Performance Intelligence

Source: `app/api/brands/kia/business-excellence/performance-intelligence/route.ts`

Scored RO Billing base:

```sql
WITH base AS (
  SELECT
    id::text AS id,
    COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
    bill_date::date AS bill_date,
    COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''), 'Unspecified') AS branch,
    COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Unspecified') AS type,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
    COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(model, ''), 'Unspecified') AS model,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
    COALESCE(NULLIF(vehicle_reg_no, ''), '') AS reg_number,
    COALESCE(NULLIF(vin, ''), NULLIF(vehicle_reg_no, ''), '') AS vehicle_key,
    COALESCE(NULLIF(bill_no, ''), '') AS bill_no,
    COALESCE(labour_amt, 0)::numeric AS labour_amt,
    COALESCE(part_amt, 0)::numeric AS part_amt,
    GREATEST(
      COALESCE(dis_amt, 0)::numeric,
      COALESCE(total_disc, 0)::numeric,
      COALESCE(NULLIF(regexp_replace(labour_disc, '[^0-9.-]', '', 'g'), '')::numeric, 0),
      COALESCE(NULLIF(regexp_replace(part_disc, '[^0-9.-]', '', 'g'), '')::numeric, 0)
    ) AS discount
  FROM ro_billing_report
  WHERE bill_date BETWEEN :startDate::date AND :endDate::date
    AND (:vehicleRegSearch IS NULL OR vehicle_reg_no ILIKE :vehicleRegSearch)
    AND (:branch = 'all' OR COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''), 'Unspecified') = :branch)
    AND (:serviceType = 'all' OR COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Unspecified') = :serviceType)
    AND (:advisor = 'all' OR COALESCE(NULLIF(service_advisor, ''), 'Unspecified') = :advisor)
    AND (:model = 'all' OR COALESCE(NULLIF(model, ''), 'Unspecified') = :model)
),
dedup AS (
  SELECT DISTINCT ON (bill_key) *
  FROM base
  ORDER BY bill_key, ABS(labour_amt) DESC, ABS(part_amt) DESC, id DESC
),
enriched AS (
  SELECT
    *,
    AVG(labour_amt) OVER (PARTITION BY model, type) AS model_labour_avg,
    AVG(part_amt) OVER (PARTITION BY model, type) AS model_parts_avg,
    AVG(labour_amt) OVER (PARTITION BY type) AS workshop_labour_avg,
    AVG(part_amt) OVER (PARTITION BY type) AS workshop_parts_avg,
    LAG(bill_date) OVER (PARTITION BY vehicle_key ORDER BY bill_date, id) AS previous_bill_date
  FROM dedup
),
scored AS (
  SELECT
    *,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN vehicle_key <> '' AND previous_bill_date IS NOT NULL AND bill_date - previous_bill_date BETWEEN 0 AND 30 THEN '30-Day Rework' END,
      CASE WHEN discount > 20 THEN 'Manual Discount' END,
      CASE WHEN part_amt > 1000 AND labour_amt = 0 THEN 'Labour Leakage' END,
      CASE WHEN model_labour_avg > 0 AND labour_amt < model_labour_avg * 0.5 THEN 'Low Labour (Model)' END,
      CASE WHEN model_parts_avg > 0 AND part_amt < model_parts_avg * 0.5 THEN 'Low Parts (Model)' END,
      CASE WHEN workshop_labour_avg > 0 AND labour_amt < workshop_labour_avg * 0.5 THEN 'Low Labour (Workshop)' END,
      CASE WHEN workshop_parts_avg > 0 AND part_amt < workshop_parts_avg * 0.5 THEN 'Low Parts (Workshop)' END
    ], NULL)::text[] AS alerts
  FROM enriched
),
scored_with_score AS (
  SELECT
    *,
    GREATEST(
      0,
      100
      - CASE WHEN '30-Day Rework' = ANY(alerts) THEN 25 ELSE 0 END
      - CASE WHEN 'Manual Discount' = ANY(alerts) THEN 10 ELSE 0 END
      - CASE WHEN 'Labour Leakage' = ANY(alerts) THEN 20 ELSE 0 END
      - CASE WHEN 'Low Labour (Model)' = ANY(alerts) THEN 10 ELSE 0 END
      - CASE WHEN 'Low Parts (Model)' = ANY(alerts) THEN 10 ELSE 0 END
      - CASE WHEN 'Low Labour (Workshop)' = ANY(alerts) THEN 5 ELSE 0 END
      - CASE WHEN 'Low Parts (Workshop)' = ANY(alerts) THEN 5 ELSE 0 END
    )::int AS score
  FROM scored
)
```

Performance payload query:

```sql
<Scored RO Billing base>
filtered AS (
  SELECT *
  FROM scored_with_score
  WHERE (:alertFilter = 'all' OR :alertFilter = ANY(alerts))
),
numbered AS (
  SELECT ROW_NUMBER() OVER (ORDER BY bill_date DESC, id DESC)::int AS sr, *
  FROM filtered
),
page_rows AS (
  SELECT *
  FROM numbered
  ORDER BY sr
  LIMIT :limit OFFSET :offset
),
alert_counts AS (
  SELECT alert_name, COUNT(*)::int AS count
  FROM filtered
  CROSS JOIN LATERAL unnest(alerts) AS alert_name
  GROUP BY alert_name
),
advisor_scores AS (
  SELECT
    advisor,
    ROUND(AVG(score))::int AS score,
    COUNT(*)::int AS transactions,
    COALESCE(SUM(cardinality(alerts)), 0)::int AS alerts
  FROM filtered
  GROUP BY advisor
  ORDER BY score DESC, transactions DESC, advisor
)
SELECT
  (SELECT COUNT(*)::int FROM scored_with_score) AS rawRowCount,
  (SELECT COUNT(*)::int FROM filtered) AS total,
  (SELECT COUNT(*)::int FROM filtered WHERE cardinality(alerts) > 0) AS alertsFound,
  (SELECT COALESCE(SUM(score), 0)::float FROM filtered) AS scoreTotal,
  COALESCE((SELECT jsonb_object_agg(alert_name, count) FROM alert_counts), '{}'::jsonb) AS alertCounts,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('advisor', advisor, 'score', score, 'transactions', transactions, 'alerts', alerts)) FROM advisor_scores), '[]'::jsonb) AS advisorScores,
  COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY sr) FROM page_rows), '[]'::jsonb) AS rows;
```

## Materialized Views And Optimization SQL

Source: `scripts/dashboard-performance-optimization.sql`

The dashboard can use these materialized views when available:

- `ro_billing_daily_summary`
- `ro_billing_daily_summary_v2`
- `workshop_performance_summary_v2`
- `workshop_performance_jc_summary_v1`
- `workshop_operation_addon_summary_v1`

Refresh sequence:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY ro_billing_daily_summary_v2;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_summary_v2;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_performance_jc_summary_v1;
REFRESH MATERIALIZED VIEW CONCURRENTLY workshop_operation_addon_summary_v1;
```

Important indexes from the optimization script:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_bill_date ON ro_billing_report (bill_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_bill_no ON ro_billing_report (bill_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ro_billing_ro_no ON ro_billing_report (ro_no);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_open_ro_ro_date ON open_ro_yearly (ro_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_complaint_date ON kia_call_center_complaints (complaint_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ew_reg_date ON ew_report (reg_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_purchase_date ON mcp_report (package_purchase_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rsa_invoice_date ON rsa_report (invoice_date);
```

## Notes

- Parent `Lab/Veh` and `Part/Veh` values in the frontend are weighted averages: amount divided by load. They are not the sum of child per-vehicle ratios.
- Workshop `LAB/RO(-VAS)` parent and Grand Total rows roll up each displayed row's already-clamped `Labour Amt - Less VAS` amount, then divide by JC. Do not recompute it from aggregate labour minus aggregate VAS.
- Normal RO Billing metrics exclude cancelled bills. Cancelled bills are returned separately in the RO Billing table response.
- EW and MCP count only `department = SERVICE`.
- EW and RSA are deduplicated before dashboard counts. MCP currently uses a filtered count without a dedupe key.
- Workshop APIs prefer materialized views only when coverage is usable; otherwise they fall back to raw source tables.
