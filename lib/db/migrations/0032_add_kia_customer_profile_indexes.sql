-- KIA Customer Profile — supporting indexes.
--
-- The section stitches a customer together across six feeds, so every query is a join or a
-- DISTINCT ON. Without these the directory query takes ~10s: the enquiry feed alone is 88,319
-- rows deduped down to 8,110 customers, and a DISTINCT ON with no matching index has to sort
-- the whole table.
--
-- ⚠️ Expression indexes must match the query text CHARACTER-FOR-CHARACTER or the planner will
-- not use them. lib/db/migrations/0026_add_phone10_match_indexes.sql records what that costs:
-- 5,274 ms for a single 120-number page. The expressions below are copied verbatim from
-- lib/kia/customer-profile/identity.ts and reader.ts — change them together or not at all.
--
-- The phone10 indexes on kia_enquiry_report already exist (migration 0026) and are reused.

-- ---------------------------------------------------------------------------------------
-- Snapshot de-duplication (DISTINCT ON support)
-- ---------------------------------------------------------------------------------------

-- latest_enquiry: DISTINCT ON (customer_id, enquiry_no) ORDER BY ... uploaded_at DESC
CREATE INDEX IF NOT EXISTS idx_kia_enquiry_report_dedupe
  ON kia_enquiry_report (customer_id, enquiry_no, uploaded_at DESC);

-- latest_booking: DISTINCT ON (booking_no) ORDER BY ... uploaded_at DESC
CREATE INDEX IF NOT EXISTS idx_kia_booking_report_dedupe
  ON kia_booking_report (booking_no, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_kia_booking_report_customer_id
  ON kia_booking_report (customer_id);

-- latest_sales: DISTINCT ON (UPPER(BTRIM(vin_number)))
CREATE INDEX IF NOT EXISTS idx_kia_sales_report_vin_dedupe
  ON kia_sales_report ((UPPER(BTRIM(vin_number))), uploaded_at DESC);

-- The sales<->service bridge: customer_id lookups on kia_sales_report.
-- ⚠️ The column is `customerid` here, with no underscore, unlike every other KIA table.
CREATE INDEX IF NOT EXISTS idx_kia_sales_report_customerid
  ON kia_sales_report ((UPPER(BTRIM(COALESCE(customerid, '')))));

-- latest_insurance: DISTINCT ON (UPPER(BTRIM(vinno))) ORDER BY ... policy_expiry_date DESC
CREATE INDEX IF NOT EXISTS idx_kia_insurance_vin_dedupe
  ON kia_insurance ((UPPER(BTRIM(vinno))), policy_expiry_date DESC);

-- ---------------------------------------------------------------------------------------
-- VIN joins into the workshop feeds
-- ---------------------------------------------------------------------------------------

-- Drives both the per-vehicle service rollup and the orphan-vehicle NOT EXISTS.
CREATE INDEX IF NOT EXISTS idx_ro_billing_report_vin_upper
  ON ro_billing_report ((UPPER(BTRIM(vin))));

CREATE INDEX IF NOT EXISTS idx_ro_billing_report_vin_bill_date
  ON ro_billing_report ((UPPER(BTRIM(vin))), bill_date DESC);

-- PSF is the identity source for service-only customers: ro_billing_report's mobile_no is
-- masked on 3,780 of 5,505 rows, so it cannot serve that purpose.
--
-- ⚠️ Index the BASE TABLE `psf_yearly`, not `kia_psf_yearly` — the latter is a VIEW and
-- Postgres rejects CREATE INDEX on views (SQLSTATE 42809). Several KIA service "tables"
-- are views over bare unprefixed base tables; see lib/data-health/feeds.ts:19.
CREATE INDEX IF NOT EXISTS idx_psf_yearly_vin_upper
  ON psf_yearly ((UPPER(BTRIM(vin))), uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_kia_complaints_vin_upper
  ON kia_call_center_complaints ((UPPER(BTRIM(COALESCE(vin_no, '')))));

-- ---------------------------------------------------------------------------------------
-- Party-key lookups
-- ---------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_kia_receipt_report_customer_id
  ON kia_receipt_report (customer_id);
