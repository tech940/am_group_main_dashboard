/**
 * The SQL behind the INDIA daily snapshot - one statement per section, one round trip each.
 *
 * Kept as strings rather than built with the query builder because each is a single dense aggregate
 * whose correctness lives in its CTE structure; splitting it into builder calls would hide the thing
 * that makes it right. Every statement takes ONE parameter, $1, the snapshot day.
 *
 * WARNING: $1 is always resolved from an IST clock by the caller. NEVER CURRENT_DATE inside these:
 * the database session runs UTC and IST is +5:30, so "today" would flip at 05:30 IST - the same
 * class of bug that shifted every KIA follow-up reminder by 5h30m.
 *
 * Reconciled cell-by-cell against the MD's own 26 August report: every insurance figure matched
 * exactly (32 of 32), sales matched exactly, and service matched but for Jammu Automart's MTD RO
 * count (1,523 here vs 1,525 there - the feed has been re-uploaded twice since that report ran).
 */

export const INDIA_SALES_SQL = `
-- INDIA SALES daily snapshot — RETAIL / BOOKINGS / ENQUIRIES, day + MTD, 4 companies + Group.
-- ONE statement, one round trip. Verified 2026-08-28: 89 ms server-side (EXPLAIN ANALYZE), every
-- access an index scan on the already-existing delivery_date / booking_date / enquiry_date indexes;
-- no table is ever scanned outside the current month. Nothing is counted in JS.
WITH b AS (
  -- $1 = the snapshot day, resolved from the caller's IST clock. NEVER CURRENT_DATE: the session
  -- runs UTC and IST is +5:30, so "today" would flip at 05:30 IST.
  SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date) AS today,
         date_trunc('month', COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date))::date AS m_start
),
-- RETAIL: one row per VEHICLE (latest upload wins), dated on delivery_date.
-- Dedupe is scoped INSIDE the month window on purpose: Hyundai/Platinum vin_number is masked to the
-- last 5 chars, so a whole-table DISTINCT ON would merge different cars across years.
retail AS (
  SELECT CASE WHEN outlet = 'JK501' THEN 'AM Kia JK501' ELSE 'AM Kia JK402' END AS company, dt
  FROM (
    SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
           UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2),''), NULLIF(BTRIM(s.dealer_code),''), NULLIF(BTRIM(s.main_dealer_code),'')))) AS outlet,
           s.delivery_date AS dt
    FROM kia_sales_report s CROSS JOIN b
    WHERE COALESCE(BTRIM(s.vin_number),'') <> ''
      AND s.delivery_date >= b.m_start AND s.delivery_date <= b.today
    ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST, s.id DESC
  ) k
  UNION ALL
  SELECT 'Jammu Automart Hyundai', dt FROM (
    SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number))) s.delivery_date AS dt
    FROM hyundai_sales_report s CROSS JOIN b
    WHERE COALESCE(BTRIM(s.vin_number),'') <> ''
      AND s.delivery_date >= b.m_start AND s.delivery_date <= b.today
    ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST, s.id DESC
  ) h
  UNION ALL
  SELECT 'Platinum Hyundai', dt FROM (
    SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number))) s.delivery_date AS dt
    FROM am_platinum_sales_report s CROSS JOIN b
    WHERE COALESCE(BTRIM(s.vin_number),'') <> ''
      AND s.delivery_date >= b.m_start AND s.delivery_date <= b.today
    ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST, s.id DESC
  ) p
),
-- BOOKINGS: booking feed UNION the enquiry feed's booking_date. The union is a no-op for KIA
-- (68 of 69 keys) and Hyundai (91 of 145) and ESSENTIAL for Platinum, whose booking export covers
-- only dealer N6250 (25 of 136).
booking_src AS (
  SELECT CASE WHEN UPPER(BTRIM(COALESCE(NULLIF(BTRIM(k.dealer_code_2),''), NULLIF(BTRIM(k.dealer_code),''), NULLIF(BTRIM(k.main_dealer),'')))) = 'JK501'
              THEN 'AM Kia JK501' ELSE 'AM Kia JK402' END AS company,
         UPPER(BTRIM(COALESCE(NULLIF(BTRIM(k.dealer_code_2),''), NULLIF(BTRIM(k.dealer_code),''), NULLIF(BTRIM(k.main_dealer),'')))) || ':' || UPPER(BTRIM(k.booking_no)) AS ky,
         k.booking_date AS dt, k.uploaded_at, k.id
  FROM kia_booking_report k CROSS JOIN b
  WHERE k.booking_date >= b.m_start AND k.booking_date <= b.today AND COALESCE(BTRIM(k.booking_no),'') <> ''
  UNION ALL
  SELECT CASE WHEN UPPER(BTRIM(COALESCE(NULLIF(BTRIM(e.dealer_code_2),''), NULLIF(BTRIM(e.dealer_code),''), NULLIF(BTRIM(e.main_dealer_code),'')))) = 'JK501'
              THEN 'AM Kia JK501' ELSE 'AM Kia JK402' END,
         UPPER(BTRIM(COALESCE(NULLIF(BTRIM(e.dealer_code_2),''), NULLIF(BTRIM(e.dealer_code),''), NULLIF(BTRIM(e.main_dealer_code),'')))) || ':' || UPPER(BTRIM(e.booking_no)),
         e.booking_date, e.uploaded_at, e.id
  FROM kia_enquiry_report e CROSS JOIN b
  WHERE e.booking_date >= b.m_start AND e.booking_date <= b.today AND COALESCE(BTRIM(e.booking_no),'') <> ''
  UNION ALL
  SELECT 'Jammu Automart Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || x.booking_date::text || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.booking_date, x.uploaded_at, x.id
  FROM hyundai_booking_report x CROSS JOIN b
  WHERE x.booking_date >= b.m_start AND x.booking_date <= b.today
  UNION ALL
  SELECT 'Jammu Automart Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || x.booking_date::text || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.booking_date, x.uploaded_at, x.id
  FROM hyundai_enquiry_report x CROSS JOIN b
  WHERE x.booking_date >= b.m_start AND x.booking_date <= b.today
  UNION ALL
  SELECT 'Platinum Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || x.booking_date::text || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.booking_date, x.uploaded_at, x.id
  FROM am_platinum_booking_report x CROSS JOIN b
  WHERE x.booking_date >= b.m_start AND x.booking_date <= b.today
  UNION ALL
  SELECT 'Platinum Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || x.booking_date::text || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.booking_date, x.uploaded_at, x.id
  FROM am_platinum_enquiry_report x CROSS JOIN b
  WHERE x.booking_date >= b.m_start AND x.booking_date <= b.today
),
bookings AS (
  SELECT DISTINCT ON (company, ky) company, dt
  FROM booking_src
  ORDER BY company, ky, uploaded_at DESC NULLS LAST, id DESC
),
-- ENQUIRIES: KIA keys on enquiry_no (it has one); the Hyundai family uses ENQUIRY_IDENTITY_SQL.
enquiry_src AS (
  SELECT CASE WHEN UPPER(BTRIM(COALESCE(NULLIF(BTRIM(e.dealer_code_2),''), NULLIF(BTRIM(e.dealer_code),''), NULLIF(BTRIM(e.main_dealer_code),'')))) = 'JK501'
              THEN 'AM Kia JK501' ELSE 'AM Kia JK402' END AS company,
         UPPER(BTRIM(COALESCE(NULLIF(BTRIM(e.dealer_code_2),''), NULLIF(BTRIM(e.dealer_code),''), NULLIF(BTRIM(e.main_dealer_code),'')))) || ':' || UPPER(BTRIM(e.enquiry_no)) AS ky,
         e.enquiry_date AS dt, e.uploaded_at, e.id
  FROM kia_enquiry_report e CROSS JOIN b
  WHERE e.enquiry_date >= b.m_start AND e.enquiry_date <= b.today AND COALESCE(BTRIM(e.enquiry_no),'') <> ''
  UNION ALL
  SELECT 'Jammu Automart Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || COALESCE(x.enquiry_date::text, '') || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.enquiry_date, x.uploaded_at, x.id
  FROM hyundai_enquiry_report x CROSS JOIN b
  WHERE x.enquiry_date >= b.m_start AND x.enquiry_date <= b.today
  UNION ALL
  SELECT 'Platinum Hyundai',
         COALESCE(NULLIF(BTRIM(x.customer_id), ''), 'row:' || x.id::text) || '|' || COALESCE(x.enquiry_date::text, '') || '|' || UPPER(BTRIM(COALESCE(x.model, ''))),
         x.enquiry_date, x.uploaded_at, x.id
  FROM am_platinum_enquiry_report x CROSS JOIN b
  WHERE x.enquiry_date >= b.m_start AND x.enquiry_date <= b.today
),
enquiries AS (
  SELECT DISTINCT ON (company, ky) company, dt
  FROM enquiry_src
  ORDER BY company, ky, uploaded_at DESC NULLS LAST, id DESC
),
facts AS (
  SELECT company, 'retail' AS metric, dt FROM retail
  UNION ALL SELECT company, 'booking', dt FROM bookings
  UNION ALL SELECT company, 'enquiry', dt FROM enquiries
),
comp (label, ord, feed_last_upload) AS (
  VALUES
    ('Jammu Automart Hyundai', 1, GREATEST((SELECT MAX(uploaded_at) FROM hyundai_sales_report),
                                           (SELECT MAX(uploaded_at) FROM hyundai_booking_report),
                                           (SELECT MAX(uploaded_at) FROM hyundai_enquiry_report))),
    ('Platinum Hyundai',       2, GREATEST((SELECT MAX(uploaded_at) FROM am_platinum_sales_report),
                                           (SELECT MAX(uploaded_at) FROM am_platinum_booking_report),
                                           (SELECT MAX(uploaded_at) FROM am_platinum_enquiry_report))),
    ('AM Kia JK402',           3, GREATEST((SELECT MAX(uploaded_at) FROM kia_sales_report),
                                           (SELECT MAX(uploaded_at) FROM kia_booking_report),
                                           (SELECT MAX(uploaded_at) FROM kia_enquiry_report))),
    ('AM Kia JK501',           4, GREATEST((SELECT MAX(uploaded_at) FROM kia_sales_report),
                                           (SELECT MAX(uploaded_at) FROM kia_booking_report),
                                           (SELECT MAX(uploaded_at) FROM kia_enquiry_report)))
),
tagged AS (
  SELECT c.label, c.ord, c.feed_last_upload, f.metric, f.dt, (f.dt = b.today) AS is_today
  FROM comp c CROSS JOIN b LEFT JOIN facts f ON f.company = c.label
)
SELECT
  CASE WHEN GROUPING(label) = 1 THEN 'Group (INDIA)' ELSE label END        AS company,
  CASE WHEN GROUPING(label) = 1 THEN 9 ELSE MIN(ord) END                   AS ord,
  COUNT(*) FILTER (WHERE metric = 'retail'  AND is_today)::int             AS retail_day,
  COUNT(*) FILTER (WHERE metric = 'retail')::int                           AS retail_mtd,
  COUNT(*) FILTER (WHERE metric = 'booking' AND is_today)::int             AS bookings_day,
  COUNT(*) FILTER (WHERE metric = 'booking')::int                          AS bookings_mtd,
  COUNT(*) FILTER (WHERE metric = 'enquiry' AND is_today)::int             AS enquiries_day,
  COUNT(*) FILTER (WHERE metric = 'enquiry')::int                          AS enquiries_mtd,
  MAX(dt) FILTER (WHERE metric = 'retail')                                 AS retail_through,
  MAX(dt) FILTER (WHERE metric = 'booking')                                AS bookings_through,
  MAX(dt) FILTER (WHERE metric = 'enquiry')                                AS enquiries_through,
  MAX(feed_last_upload)                                                    AS feed_last_upload
FROM tagged
GROUP BY GROUPING SETS ((label, ord), ())
ORDER BY 2;

/* ACTUAL OUTPUT, run read-only against the live DB on 2026-08-28 (IST today = 2026-08-28):

company                 | r_day r_mtd | b_day b_mtd | e_day e_mtd | retail_thru  bookings_thru  enquiries_thru
Jammu Automart Hyundai  |   1    82   |   0   145   |   0  1529   | 2026-08-28   2026-08-27     2026-08-27
Platinum Hyundai        |   0    61   |   2   136   |   0  1142   | 2026-08-25   2026-08-28     2026-08-27
AM Kia JK402            |   0    28   |   0    42   |   0   341   | 2026-08-26   2026-08-27     2026-08-27
AM Kia JK501            |   0    12   |   0    27   |   0   173   | 2026-08-27   2026-08-25     2026-08-27
Group (INDIA)           |   1   183   |   2   350   |   0  3185   |

Every cell was independently reproduced with a standalone query before the statement was assembled.
The all-zero ENQUIRIES day column is real feed lag, not a bug: no enquiry feed has yet uploaded a
2026-08-28 enquiry (enquiries_through = 2026-08-27 for all four companies).

File on disk: C:\\Users\\sahil\\AppData\\Local\\Temp\\claude\\C--Users-sahil-Downloads-am-group-main-dashboard\\18e03176-51db-4408-ba5c-db1469a924c4\\scratchpad\\india_sales.sql */
`

export const INDIA_SERVICE_SQL = `
/* ============================================================================
   INDIA — SERVICE (daily snapshot).  ONE statement, ONE round trip.
   Returns 5 rows: 4 companies + Group, each with DAY and MONTH-TO-DATE
   (RO count, NET, per-RO), plus data_through / day_is_covered.
   $1 = as-of date 'YYYY-MM-DD', or NULL to anchor on "today" in IST.

   NET = labour_amt + part_amt (GST-EXCLUSIVE). total_amt is tax-inclusive
   and is never used.  Customer ROs only: NVI + test-drive jobs and cancelled
   bills excluded.  Snapshot re-exports collapsed by each brand's own
   canonical dedup ranking, so every cell ties to the rupee with
   getKiaWorkshopSummary / fetchCanonicalHyundaiRoBillingMetrics /
   fetchCanonicalRoBillingMetrics.
   ============================================================================ */
WITH params AS (
  SELECT d.anchor_day, date_trunc('month', d.anchor_day)::date AS month_start
  FROM (SELECT COALESCE($1::date,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AS anchor_day) d
),

/* ---- AM KIA — kia_ro_billing_report (VIEW over ro_billing_report) ----------
   Ranking from lib/kia/workshop-summary.ts dedupCte(). Dedup FIRST over every
   active row, THEN keep the four customer categories — the reader's own order.
   Reversing it would let an NVI row sharing a bill_no evict a real bill.      */
kia_scoped AS (
  SELECT
    UPPER(BTRIM(COALESCE(NULLIF(r.dealer_code,''), NULLIF(r.main_dealer_code,'')))) AS company_code,
    COALESCE(NULLIF(r.bill_no,''), NULLIF(r.ro_no,''), r.id::text)                  AS jc_key,
    CASE
      WHEN LOWER(TRIM(COALESCE(r.work_type,''))) LIKE '%accident%'
        OR LOWER(TRIM(COALESCE(r.work_type,''))) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(TRIM(COALESCE(r.work_type,''))) LIKE '%running%'  THEN 'Running Repair'
      WHEN LOWER(TRIM(COALESCE(r.work_type,''))) LIKE '%free%'     THEN 'Free Service'
      WHEN LOWER(TRIM(COALESCE(r.work_type,''))) LIKE '%paid%'     THEN 'Paid Service'
      ELSE 'Others'          -- NVI, Test Drive/CC Maintenance, Accessories
    END                                                                            AS service_category,
    COALESCE(NULLIF(regexp_replace(r.labour_amt::text,'[^0-9.-]','','g'),''),'0')::numeric AS labour_amt,
    COALESCE(NULLIF(regexp_replace(r.part_amt::text,  '[^0-9.-]','','g'),''),'0')::numeric AS part_amt,
    r.bill_date::date AS bill_date, r.uploaded_at, r.id
  FROM kia_ro_billing_report r CROSS JOIN params p
  WHERE r.bill_date >= p.month_start
    AND r.bill_date <= p.anchor_day
    AND LOWER(TRIM(COALESCE(r.bill_status,''))) NOT IN ('cancel','cancelled','canceled')
),
kia_dedup AS (
  SELECT * FROM (
    SELECT s.*, ROW_NUMBER() OVER (
      PARTITION BY s.company_code, s.jc_key
      ORDER BY ABS(s.labour_amt + s.part_amt) DESC, s.bill_date DESC,
               s.uploaded_at DESC NULLS LAST, s.id DESC) AS rn
    FROM kia_scoped s) z
  WHERE z.rn = 1
    AND z.service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
),
kia_rows AS (
  SELECT
    CASE d.company_code WHEN 'JK402' THEN 'AM Kia JK402' ELSE 'AM Kia JK501' END AS company,
    CASE d.company_code WHEN 'JK402' THEN 3 ELSE 4 END                           AS sort_order,
    COUNT(*) FILTER (WHERE d.bill_date = p.anchor_day)::int                      AS day_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt) FILTER (WHERE d.bill_date = p.anchor_day), 0) AS day_net,
    COUNT(*)::int                                                                AS mtd_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt), 0)                                  AS mtd_net,
    MAX(d.bill_date)                                                             AS coverage_through
  FROM kia_dedup d CROSS JOIN params p
  WHERE d.company_code IN ('JK402','JK501')
  GROUP BY 1, 2
),

/* ---- Jammu Automart Hyundai — hyundai_ro_billing_report -------------------
   Ranking from lib/hyundai/ro-billing-audit.ts: dedup on
   (branch, bill_date, bill_no->r_o_no->id); RO count = DISTINCT
   (branch, r_o_no->bill_no->id).  NVI / test-drive tests are a verified
   zero-row no-op on this feed and are kept only to state the rule.           */
hy_norm AS (
  SELECT h.*, COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(h.source_dealer_code,''))),''),'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(h.dealer_code,''))),''),
      NULLIF(UPPER(TRIM(COALESCE(h.main_dealer_code,''))),'')) AS raw_code
  FROM hyundai_ro_billing_report h CROSS JOIN params p
  WHERE h.bill_date >= p.month_start
    AND h.bill_date <= p.anchor_day
    AND LOWER(TRIM(COALESCE(h.bill_type,''))) NOT LIKE '%cancel%'
    AND UPPER(BTRIM(COALESCE(h.work_type,''))) <> 'NVI'
    AND LOWER(BTRIM(COALESCE(h.work_type,''))) NOT LIKE 'test drive%'
),
hy_scoped AS (
  SELECT
    COALESCE(CASE
      WHEN raw_code IN ('N5203','N5216','JK402')          THEN 'JAMMU'
      WHEN raw_code IN ('N5701','N6844')                  THEN 'AKHNOOR'
      WHEN raw_code IN ('N5804','N6845')                  THEN 'KATHUA'
      WHEN raw_code IN ('N6815','N6846')                  THEN 'RS_PURA'
      WHEN raw_code IN ('N6819','N6847')                  THEN 'VIJAYPUR'
      WHEN raw_code IN ('N6826','N6828','N6848','JK501')  THEN 'BILLAWAR'
      WHEN UPPER(TRIM(COALESCE(source_dealer_code,''))) = 'ACTIVE' THEN 'JAMMU'
      ELSE raw_code END, 'UNMAPPED')                                              AS branch_key,
    bill_date::date                                                               AS bill_date,
    COALESCE(NULLIF(TRIM(bill_no),''), NULLIF(TRIM(r_o_no),''), id::text)         AS invoice_no,
    COALESCE(NULLIF(TRIM(r_o_no),''), NULLIF(TRIM(bill_no),''), id::text)         AS ro_no,
    COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),''),'0')::numeric AS labour_amt,
    COALESCE(NULLIF(regexp_replace(part_amt::text,  '[^0-9.-]','','g'),''),'0')::numeric AS part_amt,
    uploaded_at, id
  FROM hy_norm
),
hy_dedup AS (
  SELECT * FROM (
    SELECT s.*, ROW_NUMBER() OVER (
      PARTITION BY s.branch_key, s.bill_date, s.invoice_no
      ORDER BY ABS(s.labour_amt + s.part_amt) DESC,
               s.uploaded_at DESC NULLS LAST, s.id DESC) AS rn
    FROM hy_scoped s) z
  WHERE z.rn = 1
),
hy_rows AS (
  SELECT
    'Jammu Automart Hyundai'::text AS company, 1 AS sort_order,
    COUNT(DISTINCT d.branch_key || ':' || d.ro_no) FILTER (WHERE d.bill_date = p.anchor_day)::int AS day_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt) FILTER (WHERE d.bill_date = p.anchor_day), 0)         AS day_net,
    COUNT(DISTINCT d.branch_key || ':' || d.ro_no)::int                                           AS mtd_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt), 0)                                                   AS mtd_net,
    MAX(d.bill_date)                                                                              AS coverage_through
  FROM hy_dedup d CROSS JOIN params p
),

/* ---- Platinum Hyundai — am_platinum_ro_billing_report --------------------- */
pl_norm AS (
  SELECT pr.*, COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(pr.source_dealer_code,''))),''),'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(pr.dealer_code,''))),''),
      NULLIF(UPPER(TRIM(COALESCE(pr.main_dealer_code,''))),'')) AS raw_code
  FROM am_platinum_ro_billing_report pr CROSS JOIN params p
  WHERE pr.bill_date >= p.month_start
    AND pr.bill_date <= p.anchor_day
    AND LOWER(TRIM(COALESCE(pr.bill_type,''))) NOT LIKE '%cancel%'
    AND UPPER(BTRIM(COALESCE(pr.work_type,''))) <> 'NVI'
    AND LOWER(BTRIM(COALESCE(pr.work_type,''))) NOT LIKE 'test drive%'
),
pl_scoped AS (
  SELECT
    COALESCE(CASE
      WHEN raw_code = 'N6824'             THEN 'N6250'
      WHEN raw_code IN ('N6828','N6848')  THEN 'N6828'
      ELSE raw_code END, 'UNMAPPED')                                              AS branch_key,
    bill_date::date                                                               AS bill_date,
    COALESCE(NULLIF(TRIM(bill_no),''), NULLIF(TRIM(r_o_no),''), id::text)         AS invoice_no,
    COALESCE(NULLIF(TRIM(r_o_no),''), NULLIF(TRIM(bill_no),''), id::text)         AS ro_no,
    COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),''),'0')::numeric AS labour_amt,
    COALESCE(NULLIF(regexp_replace(part_amt::text,  '[^0-9.-]','','g'),''),'0')::numeric AS part_amt,
    uploaded_at, id
  FROM pl_norm
),
pl_dedup AS (
  SELECT * FROM (
    SELECT s.*, ROW_NUMBER() OVER (
      PARTITION BY s.branch_key, s.bill_date, s.invoice_no
      ORDER BY ABS(s.labour_amt + s.part_amt) DESC,
               s.uploaded_at DESC NULLS LAST, s.id DESC) AS rn
    FROM pl_scoped s) z
  WHERE z.rn = 1
),
pl_rows AS (
  SELECT
    'Platinum Hyundai'::text AS company, 2 AS sort_order,
    COUNT(DISTINCT d.branch_key || ':' || d.ro_no) FILTER (WHERE d.bill_date = p.anchor_day)::int AS day_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt) FILTER (WHERE d.bill_date = p.anchor_day), 0)         AS day_net,
    COUNT(DISTINCT d.branch_key || ':' || d.ro_no)::int                                           AS mtd_ro_count,
    COALESCE(SUM(d.labour_amt + d.part_amt), 0)                                                   AS mtd_net,
    MAX(d.bill_date)                                                                              AS coverage_through
  FROM pl_dedup d CROSS JOIN params p
),

companies AS (
  SELECT * FROM hy_rows
  UNION ALL SELECT * FROM pl_rows
  UNION ALL SELECT * FROM kia_rows
),
all_rows AS (
  SELECT * FROM companies
  UNION ALL
  SELECT 'Group'::text, 9,
         COALESCE(SUM(day_ro_count),0)::int, COALESCE(SUM(day_net),0),
         COALESCE(SUM(mtd_ro_count),0)::int, COALESCE(SUM(mtd_net),0),
         MIN(coverage_through)      -- the group is only as current as its laggiest feed
  FROM companies
)
SELECT
  a.company,
  p.anchor_day::text                              AS as_of_date,
  p.month_start::text                             AS month_start,
  a.coverage_through::text                        AS data_through,
  (a.coverage_through >= p.anchor_day)            AS day_is_covered,
  a.day_ro_count,
  ROUND(a.day_net, 0)                             AS day_net,
  ROUND(a.day_net / NULLIF(a.day_ro_count, 0), 0) AS day_net_per_ro,
  a.mtd_ro_count,
  ROUND(a.mtd_net, 0)                             AS mtd_net,
  ROUND(a.mtd_net / NULLIF(a.mtd_ro_count, 0), 0) AS mtd_net_per_ro
FROM all_rows a CROSS JOIN params p
ORDER BY a.sort_order;

/* ---------------------------------------------------------------------------
   VERIFIED OUTPUT, anchor 2026-08-26 (a fully-uploaded day; 427 ms warm):
     Jammu Automart Hyundai   DAY  78 / ₹648,950  / ₹8,320    MTD 1523 / ₹13,296,106 / ₹8,730
     Platinum Hyundai         DAY  36 / ₹346,502  / ₹9,625    MTD  954 / ₹ 7,782,789 / ₹8,158
     AM Kia JK402             DAY   8 / ₹110,897  / ₹13,862   MTD  204 / ₹ 1,941,510 / ₹9,517
     AM Kia JK501             DAY   4 / ₹ 18,381  / ₹4,595    MTD   44 / ₹   162,156 / ₹3,685
     Group                    DAY 126 / ₹1,124,731/ ₹8,926    MTD 2725 / ₹23,182,561 / ₹8,507
   --------------------------------------------------------------------------- */
`

export const INDIA_INSURANCE_SQL = `
-- INDIA INSURANCE — one statement, one round trip, all cells for DAY and MONTH-TO-DATE.
-- $1 = snapshot day, as a ::date resolved from the caller's IST clock (NEVER CURRENT_DATE:
-- the DB session is UTC and IST is +5:30, so "today" would flip at 05:30 IST).
-- Verified 2026-08-28 against the live DB; 515ms warm / 2.3s cold.
WITH bounds AS (
  SELECT $1::date                            AS snap_day,
         date_trunc('month', $1::date)::date AS mtd_start
),
base AS (
  /* ---- Jammu Automart Hyundai --------------------------------------------------------------
     The WHOLE table is Jammu Auto Mart: dealer_code is N5203 (to 2026-08-09) and N5216
     (from 2026-07-01), both misp_name 'JAMMU AUTO MART PRIVATE LIMITED'. DO NOT add a
     dealer_code filter — 'N5203' alone drops 453 of the 457 August rows.
     DISTINCT ON = lib/insurance/brands.ts insuranceSource(): the feed APPENDS a new row on
     re-upload instead of updating, and row_hash cannot dedupe it (a trigger makes every row
     unique). Filtering inside the subquery is safe — 0 policy_no carries two issue dates —
     and keeps the idx_..._policy_issue_date scan. */
  SELECT 'Jammu Automart Hyundai'::text AS company,
         1                              AS sort_order,
         (SELECT MAX(policy_issue_date) FROM hyundai_insurance_policy_summary) AS feed_max_issue,
         h.policy_issue_date            AS issue_date,
         UPPER(BTRIM(h.policy_type))    AS bucket,
         CASE WHEN h.net_premium ~ '^-?\\d+(\\.\\d+)?$'
              THEN h.net_premium::numeric ELSE 0 END                           AS net_amt
  FROM (
    SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text)) *
    FROM hyundai_insurance_policy_summary
    WHERE policy_issue_date BETWEEN (SELECT mtd_start FROM bounds)
                               AND (SELECT snap_day  FROM bounds)
    ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text),
             uploaded_at DESC NULLS LAST, id DESC
  ) h

  UNION ALL

  /* ---- Platinum Hyundai (dealer_code N5211) ------------------------------------------------ */
  SELECT 'Platinum Hyundai'::text, 2,
         (SELECT MAX(policy_issue_date) FROM am_platinum_insurance_policy_summary),
         p.policy_issue_date,
         UPPER(BTRIM(p.policy_type)),
         CASE WHEN p.net_premium ~ '^-?\\d+(\\.\\d+)?$'
              THEN p.net_premium::numeric ELSE 0 END
  FROM (
    SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text)) *
    FROM am_platinum_insurance_policy_summary
    WHERE policy_issue_date BETWEEN (SELECT mtd_start FROM bounds)
                               AND (SELECT snap_day  FROM bounds)
    ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text),
             uploaded_at DESC NULLS LAST, id DESC
  ) p

  UNION ALL

  /* ---- AM Kia — ONE row. dealercode is 'JK402' on all 1,445 rows; JK501 has no insurance
     feed anywhere in the DB. Premiums are NUMERIC here: the regex guard above would raise
     42883 at PARSE time and take the whole statement down. No snapshot versioning
     (brands.ts versionedByPolicyNo:false), so no DISTINCT ON. ------------------------------- */
  SELECT 'AM Kia'::text, 3,
         (SELECT MAX(create_date) FROM kia_insurance),
         k.create_date,
         UPPER(BTRIM(k.policytype)),
         COALESCE(k.netpremium, 0)
  FROM kia_insurance k
  WHERE k.create_date BETWEEN (SELECT mtd_start FROM bounds)
                          AND (SELECT snap_day  FROM bounds)
)
SELECT
  CASE WHEN GROUPING(company) = 1 THEN 99 ELSE MIN(sort_order) END AS sort_order,
  COALESCE(company, 'Group')                                       AS company,
  (SELECT snap_day  FROM bounds)                                   AS snap_day,
  (SELECT mtd_start FROM bounds)                                   AS mtd_start,
  MAX(feed_max_issue)                                              AS feed_max_issue_date,

  /* ------------------------------- DAY ------------------------------- */
  COUNT(*)              FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'RENEWAL')::int      AS day_renewal_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'RENEWAL'), 0)::numeric(16,2) AS day_renewal_net,
  COUNT(*)              FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'NEW')::int          AS day_new_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'NEW'), 0)::numeric(16,2)     AS day_new_net,
  COUNT(*)              FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'ROLLOVER')::int     AS day_rollover_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE issue_date = (SELECT snap_day FROM bounds) AND bucket = 'ROLLOVER'), 0)::numeric(16,2) AS day_rollover_net,
  COUNT(*)              FILTER (WHERE issue_date = (SELECT snap_day FROM bounds))::int                             AS day_total_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE issue_date = (SELECT snap_day FROM bounds)), 0)::numeric(16,2)               AS day_total_net,
  -- Reconciliation guard: TOTAL is COUNT(*), not renewal+new+rollover, so a new feed literal
  -- surfaces here instead of silently vanishing. Measured 0 today on every row.
  COUNT(*)              FILTER (WHERE issue_date = (SELECT snap_day FROM bounds)
                                  AND (bucket IS NULL OR bucket NOT IN ('RENEWAL','NEW','ROLLOVER')))::int        AS day_unclassified_cnt,

  /* --------------------------- MONTH TO DATE --------------------------- */
  COUNT(*)              FILTER (WHERE bucket = 'RENEWAL')::int                                                    AS mtd_renewal_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE bucket = 'RENEWAL'), 0)::numeric(16,2)                                       AS mtd_renewal_net,
  COUNT(*)              FILTER (WHERE bucket = 'NEW')::int                                                        AS mtd_new_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE bucket = 'NEW'), 0)::numeric(16,2)                                           AS mtd_new_net,
  COUNT(*)              FILTER (WHERE bucket = 'ROLLOVER')::int                                                   AS mtd_rollover_cnt,
  COALESCE(SUM(net_amt) FILTER (WHERE bucket = 'ROLLOVER'), 0)::numeric(16,2)                                      AS mtd_rollover_net,
  COUNT(*)::int                                                                                                    AS mtd_total_cnt,
  COALESCE(SUM(net_amt), 0)::numeric(16,2)                                                                         AS mtd_total_net,
  COUNT(*)              FILTER (WHERE bucket IS NULL OR bucket NOT IN ('RENEWAL','NEW','ROLLOVER'))::int           AS mtd_unclassified_cnt
FROM base
GROUP BY GROUPING SETS ((company), ())
ORDER BY 1;
`
