WITH params AS (
  SELECT d.anchor_day, date_trunc('month', d.anchor_day)::date AS month_start
  FROM (SELECT COALESCE($1::date,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AS anchor_day) d
),
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
      ELSE 'Others'
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
         MIN(coverage_through)
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
