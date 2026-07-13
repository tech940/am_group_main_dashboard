-- Platinum Business Excellence performance indexes and summary sources.
-- Safe to run inside or outside a transaction.

CREATE INDEX IF NOT EXISTS am_platinum_open_ro_fast_lookup_idx
  ON am_platinum_repair_order_list (
    (
      NULLIF(UPPER(TRIM(COALESCE(dlr_no, ''))), '')
    ),
    r_o_date,
    (COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text)),
    uploaded_at DESC,
    id DESC
  )
  WHERE LOWER(COALESCE(r_o_status, '')) = 'open';

CREATE INDEX IF NOT EXISTS am_platinum_complaints_fast_lookup_idx
  ON am_platinum_call_center_complaints (
    (
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE')
    ),
    (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)),
    (COALESCE(NULLIF(complaint_no, ''), id::text)),
    uploaded_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS am_platinum_ro_billing_fast_lookup_idx
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

CREATE INDEX IF NOT EXISTS am_platinum_sot_fast_lookup_idx
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

CREATE INDEX IF NOT EXISTS am_platinum_service_appointment_resolution_idx
  ON am_platinum_service_appointment (
    b_t_date_time,
    (COALESCE(NULLIF(TRIM(b_t_no), ''), NULLIF(TRIM(vin), ''), NULLIF(TRIM(reg_no), ''))),
    (NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'))
  );

DROP VIEW IF EXISTS am_platinum_service_appointment_resolved_v1 CASCADE;
-- security_invoker = true: the view runs with the QUERYING role's permissions/RLS, not the owner's
-- (Supabase linter 0010). Server reads use the service role (bypasses RLS + has SELECT on the base
-- table), so this only restricts untrusted PostgREST/API callers. Requires Postgres 15+.
CREATE OR REPLACE VIEW am_platinum_service_appointment_resolved_v1
  WITH (security_invoker = true) AS
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
    LOWER(COALESCE(report_type, '')) AS report_type,
    COALESCE(NULLIF(row_hash, ''), id::text) AS row_key,
    COALESCE(total_amt, 0)::numeric AS amount,
    UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
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
    -- No report_type filter here: WA/WB codes (wheel alignment, wheel balancing)
    -- have non-standard report_type values and must not be excluded at this stage.
    -- The report_type guard is applied selectively in is_vas below.
),
latest AS (
  SELECT *
  FROM ranked
  WHERE row_rank = 1
),
classified AS (
  SELECT
    *,
    -- VAS: code must be in VAS list AND report_type must be 'operation' or 'part'
    (report_type IN ('operation', 'part') AND code IN (
      'A10AA1LCERAHR','A10AAACDVAS3M','A10AAACDVASEB','A10AAACDVASEBHW','A10AAACDVASHR',
      'A10AAACDVASHRAA','A10AAACDVASHRHW','A10AAACDVASWT','A10AAACDVASWTAA','A10AAACDVASWTHW',
      'A10AAATLVASHR','A10AAATLVASHRAA','A10AAATLVASHRHW','A10AAATMVASHR','A10AAATMVASHRAA',
      'A10AAATMVASHRHW','A10AAATSVASHR','A10AAATSVASHRHW','A10AAAWPVASHR','A10AAAWPVASHRAA',
      'A10AAAWPVASHRHW','A10AAAWPVASWT','A10AAEBLVAS3M','A10AAEBLVASEB','A10AAEBLVASHR',
      'A10AAEBLVASWT','A10AAEBMVAS3M','A10AAEBMVASEB','A10AAEBMVASHR','A10AAEBMVASHRHW',
      'A10AAEBMVASWT','A10AAEBMVASWTHW','A10AAEBSVAS3M','A10AAEBSVASEB','A10AAEBSVASHR',
      'A10AAEBSVASWT','A10AAECLVAS3M','A10AAECLVASEB','A10AAECLVASHR','A10AAECLVASHRAA',
      'A10AAECLVASWT','A10AAECLVASWTAA','A10AAECMVAS3M','A10AAECMVAS3MHW','A10AAECMVASEB',
      'A10AAECMVASEBHW','A10AAECMVASHR','A10AAECMVASHRHW','A10AAECMVASWT','A10AAECMVASWTHW',
      'A10AAECSVAS3M','A10AAECSVAS3MHW','A10AAECSVASEB','A10AAECSVASEBHW','A10AAECSVASHR',
      'A10AAECSVASHRHW','A10AAECSVASWT','A10AAECSVASWTHW','A10AAEGRVASEB','A10AAEGRVASHR',
      'A10AAEGRVASHRAA','A10AAEMCVASHR','A10AAEVCVASEB','A10AAEVCVASHR','A10AAGM05TBCL',
      'A10AAHLRVAS3M','A10AAHLRVASEB','A10AAHLRVASHR','A10AAIALVAS3M','A10AAIALVASEB',
      'A10AAIALVASWR','A10AAIALVASWT','A10AAIALVASWTAA','A10AAIAMNVAS3M','A10AAIAMVAS3M',
      'A10AAIAMVASEB','A10AAIAMVASWT','A10AAIAMVASWTAA','A10AAIAMVASWTHW','A10AAIASNVAS3M',
      'A10AAIASVAS3M','A10AAIASVASEB','A10AAIASVASWR','A10AAIASVASWT','A10AAIASVASWTHW',
      'A10AAIELVAS3M','A10AAIELVASEB','A10AAIELVASHR','A10AAIELVASHRAA','A10AAIEMVAS3M',
      'A10AAIEMVASEB','A10AAIEMVASHR','A10AAIEMVASHRHW','A10AAIEMVASWT','A10AAIESVASEB',
      'A10AAIESVASHR','A10AAIESVASWT','A10AAISSVALHR','A10AAISSVALHRAA','A10AAISSVAMHR',
      'A10AAISSVAMHRAA','A10AAISSVAMHRHW','A10AAISSVAMWT','A10AAISSVASAR','A10AAISSVASEB',
      'A10AAISSVASHR','A10AAISSVASHRAA','A10AAISSVASWR','A10AAISSVASWT','A10AALUB03LNA',
      'A10AAPILVAS3M','A10AAPILVASEB','A10AAPILVASHR','A10AAPILVASWT','A10AAPILVASWTAA',
      'A10AAPIMVAS3M','A10AAPIMVASEB','A10AAPIMVASHR','A10AAPIMVASHRHW','A10AAPIMVASWT',
      'A10AAPISVASEB','A10AAPISVASHR','A10AAPISVASHRHW','A10AAPISVASWTHW','A10AAPMSVAS01',
      'A10AAPMSVAS02','A10AAPPLVAS3M','A10AAPPLVASHR','A10AAPPLVASHRAA','A10AAPPLVASWT',
      'A10AAPPLVASWTAA','A10AAPPMVAS3M','A10AAPPMVASHR','A10AAPPMVASHRHW','A10AAPPMVASWT',
      'A10AAPPSVAS3M','A10AAPPSVASEB','A10AAPPSVASHR','A10AAPPSVASHRHW','A10AAPPSVASWT',
      'A10AARRLVASEB','A10AARRLVASHR','A10AARRMVASEB','A10AARRMVASHR','A10AARRSVASEB',
      'A10AARRSVASHR','A10AARRSVASHRHW','A10AARUB19LNA','A10AASA68CROS','A10AASA68CROSAA',
      'A10AASA68CROSHW','A10AASCLVAS3M','A10AASCLVASEB','A10AASCLVASHR','A10AASCLVASHRAA',
      'A10AASCLVASWT','A10AASCMVAS3M','A10AASCMVASEB','A10AASCMVASHR','A10AASCMVASWT',
      'A10AASCSVAS3M','A10AASCSVASEB','A10AASCSVASHR','A10AASCSVASHRHW','A10AASCSVASWT',
      'A10AASPLVAS3M','A10AASPLVASEB','A10AASPLVASHR','A10AASPLVASHRAA','A10AASPLVASHRHW',
      'A10AASPLVASWT','A10AASPMVAS3M','A10AASPMVASEB','A10AASPMVASHR','A10AASPMVASHRAA',
      'A10AASPMVASHRHW','A10AASPMVASWT','A10AASPSVAS3M','A10AASPSVASEB','A10AASPSVASHR',
      'A10AASPSVASHRHW','A10AASPSVASWT','A10AATBC0003M','A10AATBC000EB','A10AATBC000HR',
      'A10AATBC000HRAA','A10AATBC000HRHW','A10AATBC000WM','A10AATBC000WR','A10AATBC000WRHW',
      'A10AATBC000WT','A10AATBC000WTAA','A10AATBC000WTHW','A10AAUBCAL03M','A10AAUBCAL0EB',
      'A10AAUBCAL0HR','A10AAUBCAL0HRAA','A10AAUBCAL0WR','A10AAUBCAL0WT','A10AAUBCAL0WTAA',
      'A10AAUBCAS03M','A10AAUBCAS0EB','A10AAUBCAS0HR','A10AAUBCAS0HRHW','A10AAUBCAS0WR',
      'A10AAUBCAS0WT','A10AAUBCAS0WTHW','A10AAWTSVASHR'
    )) AS is_vas,
    -- is_known: all VAS + WA + WB + FIC codes (used to identify "unknown code" rows)
    (
    code IN (
      'A10AAGM06WHAL','A10AAGM06WHALAA',
      'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW',
      'A10AAGM04FICL'
    ) OR (report_type IN ('operation', 'part') AND code IN (
      'A10AA1LCERAHR','A10AAACDVAS3M','A10AAACDVASEB','A10AAACDVASEBHW','A10AAACDVASHR',
      'A10AAACDVASHRAA','A10AAACDVASHRHW','A10AAACDVASWT','A10AAACDVASWTAA','A10AAACDVASWTHW',
      'A10AAATLVASHR','A10AAATLVASHRAA','A10AAATLVASHRHW','A10AAATMVASHR','A10AAATMVASHRAA',
      'A10AAATMVASHRHW','A10AAATSVASHR','A10AAATSVASHRHW','A10AAAWPVASHR','A10AAAWPVASHRAA',
      'A10AAAWPVASHRHW','A10AAAWPVASWT','A10AAEBLVAS3M','A10AAEBLVASEB','A10AAEBLVASHR',
      'A10AAEBLVASWT','A10AAEBMVAS3M','A10AAEBMVASEB','A10AAEBMVASHR','A10AAEBMVASHRHW',
      'A10AAEBMVASWT','A10AAEBMVASWTHW','A10AAEBSVAS3M','A10AAEBSVASEB','A10AAEBSVASHR',
      'A10AAEBSVASWT','A10AAECLVAS3M','A10AAECLVASEB','A10AAECLVASHR','A10AAECLVASHRAA',
      'A10AAECLVASWT','A10AAECLVASWTAA','A10AAECMVAS3M','A10AAECMVAS3MHW','A10AAECMVASEB',
      'A10AAECMVASEBHW','A10AAECMVASHR','A10AAECMVASHRHW','A10AAECMVASWT','A10AAECMVASWTHW',
      'A10AAECSVAS3M','A10AAECSVAS3MHW','A10AAECSVASEB','A10AAECSVASEBHW','A10AAECSVASHR',
      'A10AAECSVASHRHW','A10AAECSVASWT','A10AAECSVASWTHW','A10AAEGRVASEB','A10AAEGRVASHR',
      'A10AAEGRVASHRAA','A10AAEMCVASHR','A10AAEVCVASEB','A10AAEVCVASHR','A10AAGM05TBCL',
      'A10AAHLRVAS3M','A10AAHLRVASEB','A10AAHLRVASHR','A10AAIALVAS3M','A10AAIALVASEB',
      'A10AAIALVASWR','A10AAIALVASWT','A10AAIALVASWTAA','A10AAIAMNVAS3M','A10AAIAMVAS3M',
      'A10AAIAMVASEB','A10AAIAMVASWT','A10AAIAMVASWTAA','A10AAIAMVASWTHW','A10AAIASNVAS3M',
      'A10AAIASVAS3M','A10AAIASVASEB','A10AAIASVASWR','A10AAIASVASWT','A10AAIASVASWTHW',
      'A10AAIELVAS3M','A10AAIELVASEB','A10AAIELVASHR','A10AAIELVASHRAA','A10AAIEMVAS3M',
      'A10AAIEMVASEB','A10AAIEMVASHR','A10AAIEMVASHRHW','A10AAIEMVASWT','A10AAIESVASEB',
      'A10AAIESVASHR','A10AAIESVASWT','A10AAISSVALHR','A10AAISSVALHRAA','A10AAISSVAMHR',
      'A10AAISSVAMHRAA','A10AAISSVAMHRHW','A10AAISSVAMWT','A10AAISSVASAR','A10AAISSVASEB',
      'A10AAISSVASHR','A10AAISSVASHRAA','A10AAISSVASWR','A10AAISSVASWT','A10AALUB03LNA',
      'A10AAPILVAS3M','A10AAPILVASEB','A10AAPILVASHR','A10AAPILVASWT','A10AAPILVASWTAA',
      'A10AAPIMVAS3M','A10AAPIMVASEB','A10AAPIMVASHR','A10AAPIMVASHRHW','A10AAPIMVASWT',
      'A10AAPISVASEB','A10AAPISVASHR','A10AAPISVASHRHW','A10AAPISVASWTHW','A10AAPMSVAS01',
      'A10AAPMSVAS02','A10AAPPLVAS3M','A10AAPPLVASHR','A10AAPPLVASHRAA','A10AAPPLVASWT',
      'A10AAPPLVASWTAA','A10AAPPMVAS3M','A10AAPPMVASHR','A10AAPPMVASHRHW','A10AAPPMVASWT',
      'A10AAPPSVAS3M','A10AAPPSVASEB','A10AAPPSVASHR','A10AAPPSVASHRHW','A10AAPPSVASWT',
      'A10AARRLVASEB','A10AARRLVASHR','A10AARRMVASEB','A10AARRMVASHR','A10AARRSVASEB',
      'A10AARRSVASHR','A10AARRSVASHRHW','A10AARUB19LNA','A10AASA68CROS','A10AASA68CROSAA',
      'A10AASA68CROSHW','A10AASCLVAS3M','A10AASCLVASEB','A10AASCLVASHR','A10AASCLVASHRAA',
      'A10AASCLVASWT','A10AASCMVAS3M','A10AASCMVASEB','A10AASCMVASHR','A10AASCMVASWT',
      'A10AASCSVAS3M','A10AASCSVASEB','A10AASCSVASHR','A10AASCSVASHRHW','A10AASCSVASWT',
      'A10AASPLVAS3M','A10AASPLVASEB','A10AASPLVASHR','A10AASPLVASHRAA','A10AASPLVASHRHW',
      'A10AASPLVASWT','A10AASPMVAS3M','A10AASPMVASEB','A10AASPMVASHR','A10AASPMVASHRAA',
      'A10AASPMVASHRHW','A10AASPMVASWT','A10AASPSVAS3M','A10AASPSVASEB','A10AASPSVASHR',
      'A10AASPSVASHRHW','A10AASPSVASWT','A10AATBC0003M','A10AATBC000EB','A10AATBC000HR',
      'A10AATBC000HRAA','A10AATBC000HRHW','A10AATBC000WM','A10AATBC000WR','A10AATBC000WRHW',
      'A10AATBC000WT','A10AATBC000WTAA','A10AATBC000WTHW','A10AAUBCAL03M','A10AAUBCAL0EB',
      'A10AAUBCAL0HR','A10AAUBCAL0HRAA','A10AAUBCAL0WR','A10AAUBCAL0WT','A10AAUBCAL0WTAA',
      'A10AAUBCAS03M','A10AAUBCAS0EB','A10AAUBCAS0HR','A10AAUBCAS0HRHW','A10AAUBCAS0WR',
      'A10AAUBCAS0WT','A10AAUBCAS0WTHW','A10AAWTSVASHR'
    ))
    ) AS is_known
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
      NULLIF(UPPER(TRIM(COALESCE(dlr_no, ''))), ''),
      'UNMAPPED'
    ),
    COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text)
  )
    COALESCE(
      NULLIF(UPPER(TRIM(COALESCE(dlr_no, ''))), ''),
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
