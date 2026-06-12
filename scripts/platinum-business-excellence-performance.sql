-- Platinum Business Excellence performance indexes and summary sources.
-- Run outside a transaction because CREATE INDEX CONCURRENTLY is used.

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_open_ro_fast_lookup_idx
  ON am_platinum_repair_order_list (
    (
      COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), '')
      )
    ),
    r_o_date,
    (COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text)),
    uploaded_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(r_o_status, '')) = 'open';

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_complaints_fast_lookup_idx
  ON am_platinum_call_center_complaints (
    (
      COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), '')
      )
    ),
    (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)),
    (COALESCE(NULLIF(complaint_no, ''), id::text)),
    uploaded_at DESC,
    id DESC
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_ro_billing_fast_lookup_idx
  ON am_platinum_ro_billing_report (
    bill_date,
    (
      COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), '')
      )
    ),
    (COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)),
    uploaded_at DESC,
    id DESC
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_sot_fast_lookup_idx
  ON am_platinum_trust_package (
    reg_date,
    (
      COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        'N5211'
      )
    ),
    (COALESCE(NULLIF(cert_no, ''), NULLIF(vin, ''), id::text)),
    uploaded_at DESC,
    id DESC
  );

CREATE MATERIALIZED VIEW IF NOT EXISTS am_platinum_ro_billing_daily_summary_v1 AS
WITH latest AS (
  SELECT DISTINCT ON (
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
      'UNMAPPED'
    ),
    COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
  )
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
      'UNMAPPED'
    ) AS dealer_code,
    bill_date::date AS report_date,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
    COALESCE(labour_amt, 0)::numeric AS labour_amount,
    COALESCE(part_amt, 0)::numeric AS parts_amount,
    COALESCE(total_amt, COALESCE(labour_amt, 0) + COALESCE(part_amt, 0))::numeric AS revenue,
    uploaded_at
  FROM am_platinum_ro_billing_report
  WHERE bill_date IS NOT NULL
    AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
  ORDER BY 1,
    COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text),
    uploaded_at DESC NULLS LAST,
    id DESC
)
SELECT
  dealer_code,
  report_date,
  work_type,
  advisor,
  COUNT(*)::int AS total_jc,
  SUM(labour_amount)::numeric AS labour_amount,
  SUM(parts_amount)::numeric AS parts_amount,
  SUM(revenue)::numeric AS revenue,
  MAX(uploaded_at) AS uploaded_at
FROM latest
GROUP BY dealer_code, report_date, work_type, advisor;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_ro_billing_daily_summary_v1_unique
  ON am_platinum_ro_billing_daily_summary_v1 (dealer_code, report_date, work_type, advisor);

CREATE MATERIALIZED VIEW IF NOT EXISTS am_platinum_open_ro_daily_summary_v1 AS
WITH latest AS (
  SELECT DISTINCT ON (
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), ''),
      'UNMAPPED'
    ),
    COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text)
  )
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), ''),
      'UNMAPPED'
    ) AS dealer_code,
    r_o_date::date AS report_date,
    COALESCE(NULLIF(svc_adv, ''), 'Unspecified') AS advisor,
    COALESCE(NULLIF(work_type, ''), 'Others') AS work_type,
    GREATEST((CURRENT_DATE - r_o_date::date)::int, 0) AS aging_days,
    uploaded_at
  FROM am_platinum_repair_order_list
  WHERE LOWER(COALESCE(r_o_status, '')) = 'open'
    AND r_o_date IS NOT NULL
  ORDER BY 1, COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text),
    uploaded_at DESC NULLS LAST, id DESC
)
SELECT
  dealer_code,
  report_date,
  advisor,
  work_type,
  COUNT(*)::int AS open_ro,
  AVG(aging_days)::numeric AS avg_aging,
  COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15,
  MAX(uploaded_at) AS uploaded_at
FROM latest
GROUP BY dealer_code, report_date, advisor, work_type;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_open_ro_daily_summary_v1_unique
  ON am_platinum_open_ro_daily_summary_v1 (dealer_code, report_date, advisor, work_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS am_platinum_complaints_daily_summary_v1 AS
WITH latest AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
      'UNMAPPED'
    ) AS dealer_code,
    COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date AS report_date,
    CASE
      WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
      WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
      WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
      ELSE 'Open'
    END AS status_group,
    COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS area,
    uploaded_at
  FROM am_platinum_call_center_complaints
  WHERE COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date) IS NOT NULL
  ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
)
SELECT
  dealer_code,
  report_date,
  status_group,
  area,
  COUNT(*)::int AS complaints,
  MAX(uploaded_at) AS uploaded_at
FROM latest
GROUP BY dealer_code, report_date, status_group, area;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_complaints_daily_summary_v1_unique
  ON am_platinum_complaints_daily_summary_v1 (dealer_code, report_date, status_group, area);
