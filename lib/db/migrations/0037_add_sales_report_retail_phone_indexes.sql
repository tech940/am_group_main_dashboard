-- Retail-list customer phone lookup for the Hyundai and Platinum Sales Reports.
--
-- ── The problem ───────────────────────────────────────────────────────────────────────────────
-- The sales feed masks its own phone column (`98****4048`), so the retail transactions list
-- recovers a real number from the enquiry feed with a LATERAL correlated per sales row:
--
--     LEFT JOIN LATERAL (
--       SELECT e.contact_number FROM <brand>_enquiry_report e
--       WHERE (e.customer_id = s.customerid)
--          OR (UPPER(TRIM(e.name_of_the_customer)) = UPPER(TRIM(s.registration_name)) AND e.model = s.model)
--       ORDER BY e.enquiry_date DESC LIMIT 1) enq ON TRUE
--
-- Neither branch of that OR was indexable, so Postgres walked the enquiry table once per sales row.
-- Measured on a twelve-month window (447 sales rows against 226,110 enquiries):
--
--     without these indexes   19,153 ms      <- 21.7 s of a 24.2 s page load
--     with these indexes         335 ms      <- 57x faster, planner switches to a BitmapOr
--
-- Verified by creating both indexes inside a transaction, running EXPLAIN ANALYZE, and rolling back.
--
-- The application change that ships alongside this only builds the LATERAL for viewers who can
-- actually see a customer phone (canViewPii). That already removed the cost for most users; these
-- indexes are what fix it for the MD and the other PII roles, who are the ones who read this list.
--
-- ⚠️ `enquiry_date DESC` is part of each index on purpose — it serves the `ORDER BY e.enquiry_date
-- DESC LIMIT 1` that picks the most recent enquiry, so the plan never sorts.
--
-- ⚠️ Platinum's table is `am_platinum_enquiry_report`. It was renamed from
-- `am_platinum_hyundai_enquiry_report`, which survives only as the name of its primary key.
--
-- Migrations in this repo are applied BY HAND. Run `npm run db:backup` first. DDL cannot run through
-- the pgbouncer transaction pooler — use the direct/session port.

-- ── Hyundai ───────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hyundai_enquiry_report_customer_id_date
  ON hyundai_enquiry_report (customer_id, enquiry_date DESC);

CREATE INDEX IF NOT EXISTS idx_hyundai_enquiry_report_name_model_date
  ON hyundai_enquiry_report (UPPER(TRIM(name_of_the_customer)), model, enquiry_date DESC);

-- ── AM Platinum ───────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_am_platinum_enquiry_report_customer_id_date
  ON am_platinum_enquiry_report (customer_id, enquiry_date DESC);

CREATE INDEX IF NOT EXISTS idx_am_platinum_enquiry_report_name_model_date
  ON am_platinum_enquiry_report (UPPER(TRIM(name_of_the_customer)), model, enquiry_date DESC);

-- The planner needs statistics on the EXPRESSION, not just the columns, to choose the second index.
ANALYZE hyundai_enquiry_report;
ANALYZE am_platinum_enquiry_report;
