-- Refresh platinum VAS period summary (mirror am_platinum_vas_period_summary_v1).
-- Schedule: after each successful dual-write batch for operation_wise_analysis.

CREATE OR REPLACE TABLE `${PROJECT_ID}.platinum_aggregates.vas_period_summary`
PARTITION BY period_start
CLUSTER BY dealer_code, period_end
AS
SELECT
  resolved_dealer_code AS dealer_code,
  report_period_start AS period_start,
  report_period_end AS period_end,
  COUNT(*) AS period_rows,
  COUNTIF(is_vas) AS source_rows,
  SUM(IF(is_vas, total_amt, 0)) AS vas_amount,
  MAX(uploaded_at) AS uploaded_at,
  CURRENT_TIMESTAMP() AS refreshed_at
FROM (
  SELECT
    *,
    (
      REGEXP_CONTAINS(LOWER(op_part_code), r'(^|[^a-z0-9])vas|vas([a-z0-9]|$)')
      OR REGEXP_CONTAINS(LOWER(op_part_desc), r'value[[:space:]-]*added|vas')
    ) AS is_vas
  FROM `${PROJECT_ID}.platinum_facts.operation_wise_analysis`
  WHERE LOWER(report_type) IN ('operation', 'part')
)
GROUP BY 1, 2, 3;
