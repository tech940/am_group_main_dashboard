-- Refresh Platinum VAS period summary after each successful operation-wise load.
-- Keep this catalog synchronized with lib/platinum/vas-identifiers.ts.

CREATE OR REPLACE TABLE `${PROJECT_ID}.platinum_aggregates.vas_period_summary`
PARTITION BY period_start
CLUSTER BY dealer_code, period_end
AS
WITH catalog AS (
  SELECT code, category
  FROM UNNEST([
    STRUCT('A10AA1LCERAHR' AS code, 'vas' AS category),('A10AAACDVASHR','vas'),('A10AAACDVASHRAA','vas'),
    ('A10AAACDVASHRHW','vas'),('A10AAACDVASWT','vas'),('A10AAATLVASHR','vas'),('A10AAATLVASHRHW','vas'),
    ('A10AAATMVASHR','vas'),('A10AAATMVASHRHW','vas'),('A10AAATSVASHR','vas'),('A10AAATSVASHRHW','vas'),
    ('A10AAAWPVASHR','vas'),('A10AAAWPVASHRAA','vas'),('A10AAAWPVASWT','vas'),('A10AAEBLVAS3M','vas'),
    ('A10AAEBLVASHR','vas'),('A10AAEBMVASHR','vas'),('A10AAEBSVASHR','vas'),('A10AAECLVAS3M','vas'),
    ('A10AAECLVASEB','vas'),('A10AAECLVASHR','vas'),('A10AAECLVASHRAA','vas'),('A10AAECLVASWT','vas'),
    ('A10AAECMVAS3M','vas'),('A10AAECMVASEB','vas'),('A10AAECMVASHR','vas'),('A10AAECMVASHRHW','vas'),
    ('A10AAECMVASWT','vas'),('A10AAECMVASWTHW','vas'),('A10AAECSVASEBHW','vas'),('A10AAECSVASHR','vas'),
    ('A10AAECSVASHRHW','vas'),('A10AAECSVASWT','vas'),('A10AAECSVASWTHW','vas'),('A10AAEGRVASHR','vas'),
    ('A10AAEGRVASHRAA','vas'),('A10AAGM05TBCL','vas'),('A10AAHLRVASHR','vas'),('A10AAIALVASWT','vas'),
    ('A10AAIAMVASWT','vas'),('A10AAIAMVASWTHW','vas'),('A10AAIASVASWT','vas'),('A10AAIELVASHR','vas'),
    ('A10AAIEMVASHR','vas'),('A10AAIESVASHR','vas'),('A10AAISSVALHR','vas'),('A10AAISSVAMHR','vas'),
    ('A10AAISSVASHR','vas'),('A10AALUB03LNA','vas'),('A10AAPILVAS3M','vas'),('A10AAPILVASEB','vas'),
    ('A10AAPILVASHR','vas'),('A10AAPIMVASHR','vas'),('A10AAPISVASHR','vas'),('A10AAPPLVASHR','vas'),
    ('A10AAPPLVASWT','vas'),('A10AAPPLVASWTAA','vas'),('A10AAPPMVASHR','vas'),('A10AAPPMVASHRHW','vas'),
    ('A10AAPPMVASWT','vas'),('A10AAPPSVASHR','vas'),('A10AAPPSVASWT','vas'),('A10AARRLVASHR','vas'),
    ('A10AARRMVASHR','vas'),('A10AARRSVASHR','vas'),('A10AARUB19LNA','vas'),('A10AASA68CROS','vas'),
    ('A10AASA68CROSAA','vas'),('A10AASCLVASHR','vas'),('A10AASCLVASHRAA','vas'),('A10AASCMVAS3M','vas'),
    ('A10AASCMVASEB','vas'),('A10AASCMVASHR','vas'),('A10AASCMVASWT','vas'),('A10AASCSVAS3M','vas'),
    ('A10AASCSVASEB','vas'),('A10AASCSVASHR','vas'),('A10AASCSVASWT','vas'),('A10AASPLVAS3M','vas'),
    ('A10AASPLVASEB','vas'),('A10AASPLVASHR','vas'),('A10AASPLVASHRAA','vas'),('A10AASPLVASHRHW','vas'),
    ('A10AASPLVASWT','vas'),('A10AASPMVAS3M','vas'),('A10AASPMVASHR','vas'),('A10AASPMVASHRAA','vas'),
    ('A10AASPMVASHRHW','vas'),('A10AASPMVASWT','vas'),('A10AASPSVASEB','vas'),('A10AASPSVASHR','vas'),
    ('A10AASPSVASHRHW','vas'),('A10AASPSVASWT','vas'),('A10AATBC0003M','vas'),('A10AATBC000HR','vas'),
    ('A10AATBC000HRHW','vas'),('A10AATBC000WR','vas'),('A10AATBC000WT','vas'),('A10AATBC000WTHW','vas'),
    ('A10AAUBCAL03M','vas'),('A10AAUBCAL0HR','vas'),('A10AAUBCAL0HRAA','vas'),('A10AAUBCAL0WR','vas'),
    ('A10AAUBCAS03M','vas'),('A10AAUBCAS0EB','vas'),('A10AAUBCAS0HR','vas'),('A10AAUBCAS0WR','vas'),
    ('A10AAUBCAS0WT','vas'),('A10AAWTSVASHR','vas'),
    ('A10AAGM06WHAL','wheel_alignment'),('A10AAGM06WHALAA','wheel_alignment'),('A10AAGM06WHALHW','wheel_alignment'),
    ('A10AAGM07WHBL','wheel_balancing'),('A10AAGM07WHBLAA','wheel_balancing'),('A10AAGM07WHBLHW','wheel_balancing'),
    ('A10AAGM04FICL','fuel_injector')
  ])
),
latest AS (
  SELECT * EXCEPT(row_rank)
  FROM (
    SELECT
      source.*,
      UPPER(TRIM(COALESCE(op_part_code, ''))) AS normalized_code,
      ROW_NUMBER() OVER (
        PARTITION BY resolved_dealer_code, report_period_start, report_period_end, COALESCE(NULLIF(row_hash, ''), CAST(id AS STRING))
        ORDER BY uploaded_at DESC, id DESC
      ) AS row_rank
    FROM `${PROJECT_ID}.platinum_facts.operation_wise_analysis` source
    WHERE LOWER(report_type) IN ('operation', 'part')
  )
  WHERE row_rank = 1
)
SELECT
  resolved_dealer_code AS dealer_code,
  report_period_start AS period_start,
  report_period_end AS period_end,
  COUNT(*) AS period_rows,
  COUNTIF(catalog.category = 'vas') AS source_rows,
  COUNTIF(normalized_code <> '' AND catalog.code IS NULL) AS unknown_code_rows,
  SUM(IF(catalog.category = 'vas', total_amt, 0)) AS vas_amount,
  MAX(uploaded_at) AS uploaded_at,
  CURRENT_TIMESTAMP() AS refreshed_at
FROM latest
LEFT JOIN catalog ON catalog.code = latest.normalized_code
GROUP BY 1, 2, 3;
