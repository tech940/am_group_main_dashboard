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
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE')
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

CREATE INDEX CONCURRENTLY IF NOT EXISTS am_platinum_service_appointment_resolution_idx
  ON am_platinum_service_appointment (
    b_t_date_time,
    (COALESCE(NULLIF(TRIM(b_t_no), ''), NULLIF(TRIM(vin), ''), NULLIF(TRIM(reg_no), ''))),
    (NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'))
  );

CREATE OR REPLACE VIEW am_platinum_service_appointment_resolved_v1 AS
SELECT
  source.*,
  CASE
    WHEN NULLIF(NULLIF(UPPER(TRIM(COALESCE(source.source_dealer_code, ''))), ''), 'ACTIVE') IS NOT NULL
      THEN NULLIF(NULLIF(UPPER(TRIM(COALESCE(source.source_dealer_code, ''))), ''), 'ACTIVE')
    WHEN EXISTS (
      SELECT 1
      FROM am_platinum_service_appointment explicit_row
      WHERE UPPER(TRIM(COALESCE(explicit_row.source_dealer_code, ''))) = 'N6250'
        AND explicit_row.b_t_date_time = source.b_t_date_time
        AND COALESCE(
          NULLIF(TRIM(explicit_row.b_t_no), ''),
          NULLIF(TRIM(explicit_row.vin), ''),
          NULLIF(TRIM(explicit_row.reg_no), '')
        ) = COALESCE(
          NULLIF(TRIM(source.b_t_no), ''),
          NULLIF(TRIM(source.vin), ''),
          NULLIF(TRIM(source.reg_no), '')
        )
    ) THEN 'N6250'
    ELSE 'UNMAPPED'
  END AS resolved_dealer_code
FROM am_platinum_service_appointment source;

DROP MATERIALIZED VIEW IF EXISTS am_platinum_ro_billing_daily_summary_v1;

CREATE MATERIALIZED VIEW am_platinum_ro_billing_daily_summary_v1 AS
WITH latest AS (
  SELECT DISTINCT ON (
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
      'UNMAPPED'
    ),
    bill_date::date,
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
    (COALESCE(labour_amt, 0) + COALESCE(part_amt, 0))::numeric AS revenue,
    uploaded_at
  FROM am_platinum_ro_billing_report
  WHERE bill_date IS NOT NULL
    AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
  ORDER BY 1, bill_date::date,
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

DROP MATERIALIZED VIEW IF EXISTS am_platinum_ro_billing_daily_summary_v2;
DROP MATERIALIZED VIEW IF EXISTS am_platinum_workshop_performance_jc_summary_v2;

CREATE MATERIALIZED VIEW am_platinum_workshop_performance_jc_summary_v2 AS
WITH ranked AS (
  SELECT
    id,
    CASE
      WHEN COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
        NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
        'UNMAPPED'
      ) = 'N6824' THEN 'N6250'
      ELSE COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
        NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
        'UNMAPPED'
      )
    END AS dealer_code,
    (
      CASE
        WHEN COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
          'UNMAPPED'
        ) = 'N6824' THEN 'N6250'
        ELSE COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
          'UNMAPPED'
        )
      END
    ) || ':' || bill_date::date::text || ':' || COALESCE(
      NULLIF(TRIM(bill_no::text), ''),
      NULLIF(TRIM(r_o_no::text), ''),
      id::text
    ) AS invoice_key,
    (
      CASE
        WHEN COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
          'UNMAPPED'
        ) = 'N6824' THEN 'N6250'
        ELSE COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
          'UNMAPPED'
        )
      END
    ) || ':' || COALESCE(
      NULLIF(TRIM(r_o_no::text), ''),
      NULLIF(TRIM(bill_no::text), ''),
      id::text
    ) AS ro_key,
    bill_date::date AS report_date,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS group_type,
    COALESCE(NULLIF(work_type, ''), 'Unspecified') AS service_type,
    COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS service_advisor,
    COALESCE(labour_amt, 0)::numeric AS labour_amount,
    COALESCE(part_amt, 0)::numeric AS part_amount,
    (COALESCE(labour_amt, 0) + COALESCE(part_amt, 0))::numeric AS total_amount,
    COALESCE(total_amt, 0)::numeric AS gross_total,
    GREATEST(
      COALESCE(dis_amt, 0)::numeric,
      COALESCE(total_disc, 0)::numeric,
      COALESCE(NULLIF(regexp_replace(labour_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0),
      COALESCE(NULLIF(regexp_replace(part_disc::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)
    ) AS discount_amount,
    uploaded_at,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
            'UNMAPPED'
          ) = 'N6824' THEN 'N6250'
          ELSE COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), ''),
            'UNMAPPED'
          )
        END,
        bill_date::date,
        COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
      ORDER BY uploaded_at DESC NULLS LAST, id DESC
    ) AS row_rank
  FROM am_platinum_ro_billing_report
  WHERE bill_date IS NOT NULL
    AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
)
SELECT
  dealer_code,
  invoice_key,
  ro_key,
  report_date,
  group_type,
  service_type,
  service_advisor,
  labour_amount,
  part_amount,
  total_amount,
  gross_total,
  discount_amount,
  uploaded_at
FROM ranked
WHERE row_rank = 1;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_workshop_performance_jc_summary_v2_unique
  ON am_platinum_workshop_performance_jc_summary_v2 (invoice_key);

CREATE INDEX IF NOT EXISTS am_platinum_workshop_performance_jc_summary_v2_date_dealer_idx
  ON am_platinum_workshop_performance_jc_summary_v2 (report_date, dealer_code);

CREATE INDEX IF NOT EXISTS am_platinum_workshop_performance_jc_summary_v2_ro_idx
  ON am_platinum_workshop_performance_jc_summary_v2 (dealer_code, ro_key, report_date);

CREATE MATERIALIZED VIEW am_platinum_ro_billing_daily_summary_v2 AS
SELECT
  dealer_code,
  report_date AS bill_date,
  COUNT(DISTINCT ro_key)::int AS load_count,
  COUNT(*)::int AS invoice_count,
  SUM(labour_amount)::numeric AS labour_amount,
  SUM(part_amount)::numeric AS part_amount,
  SUM(total_amount)::numeric AS revenue,
  SUM(gross_total)::numeric AS gross_total,
  MAX(uploaded_at) AS uploaded_at
FROM am_platinum_workshop_performance_jc_summary_v2
GROUP BY dealer_code, report_date;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_ro_billing_daily_summary_v2_unique
  ON am_platinum_ro_billing_daily_summary_v2 (dealer_code, bill_date);

DROP MATERIALIZED VIEW IF EXISTS am_platinum_vas_period_summary_v1;

CREATE MATERIALIZED VIEW am_platinum_vas_period_summary_v1 AS
WITH ranked AS (
  SELECT
    CASE
      WHEN COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        'UNMAPPED'
      ) = 'N6824' THEN 'N6250'
      ELSE COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        'UNMAPPED'
      )
    END AS dealer_code,
    report_period_start::date AS period_start,
    report_period_end::date AS period_end,
    COALESCE(NULLIF(row_hash, ''), id::text) AS row_key,
    COALESCE(total_amt, 0)::numeric AS amount,
    LOWER(COALESCE(op_part_code, '')) AS code,
    LOWER(COALESCE(op_part_desc, '')) AS description,
    uploaded_at,
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
            'UNMAPPED'
          ) = 'N6824' THEN 'N6250'
          ELSE COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
            'UNMAPPED'
          )
        END,
        report_period_start::date,
        report_period_end::date,
        COALESCE(NULLIF(row_hash, ''), id::text)
      ORDER BY uploaded_at DESC NULLS LAST, id DESC
    ) AS row_rank
  FROM am_platinum_operation_wise_analysis_report
  WHERE report_period_start IS NOT NULL
    AND report_period_end IS NOT NULL
    AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
),
latest AS (
  SELECT *
  FROM ranked
  WHERE row_rank = 1
),
classified AS (
  SELECT
    *,
    (
      (
        code ~ '(^|[^a-z0-9])vas|vas([a-z0-9]|$)'
        OR description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
        OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
        OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
        OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*(cleaning|dressing)|service[[:space:]-]*lubrication|lubrication[[:space:]]*\(|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
        OR description ~ '(interior[[:space:]-]*antimicrobial|exterior[[:space:]-]*beautification|paint[[:space:]-]*protection|egr[[:space:]-]*cleaner|fuel[[:space:]-]*injector)'
      )
      AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
      AND description !~ '(water[[:space:]-]*borne|body[[:space:]-]*shop|bodyshop|denting|accidental[[:space:]-]*repair)'
    ) AS is_vas
  FROM latest
)
SELECT
  dealer_code,
  period_start,
  period_end,
  COUNT(*)::int AS period_rows,
  COUNT(*) FILTER (WHERE is_vas)::int AS source_rows,
  COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::numeric AS vas_amount,
  MAX(uploaded_at) AS uploaded_at
FROM classified
GROUP BY dealer_code, period_start, period_end;

CREATE UNIQUE INDEX IF NOT EXISTS am_platinum_vas_period_summary_v1_unique
  ON am_platinum_vas_period_summary_v1 (dealer_code, period_start, period_end);

CREATE INDEX IF NOT EXISTS am_platinum_vas_period_summary_v1_period_idx
  ON am_platinum_vas_period_summary_v1 (period_start, period_end, dealer_code);

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

DROP MATERIALIZED VIEW IF EXISTS am_platinum_complaints_daily_summary_v1;

CREATE MATERIALIZED VIEW am_platinum_complaints_daily_summary_v1 AS
WITH latest AS (
  SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
    COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
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
