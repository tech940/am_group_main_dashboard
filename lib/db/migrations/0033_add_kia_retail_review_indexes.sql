-- MD Retail Review performance. The conversion and exchange panels attribute each retailed
-- vehicle to its buyer's enquiries via LATERAL lookups keyed on UPPER(BTRIM(customer_id)) —
-- without a matching functional index that is a full scan of kia_enquiry_report (~88k rows)
-- PER RETAILED VEHICLE: measured 38.1s for the exchange panel, 9.5s for conversion.

-- Both LATERALs probe on the normalised customer key. Conversion also orders by enquiry_date.
CREATE INDEX IF NOT EXISTS idx_kia_enquiry_customer_key_date
  ON kia_enquiry_report ((UPPER(BTRIM(COALESCE(customer_id, '')))), enquiry_date DESC);

-- The shared enquiry cohort dedupe: DISTINCT ON (customer_id, enquiry_no) ... uploaded_at DESC.
CREATE INDEX IF NOT EXISTS idx_kia_enquiry_dedupe
  ON kia_enquiry_report (customer_id, enquiry_no, uploaded_at DESC);

-- The retail spine dedupe: DISTINCT ON (UPPER(BTRIM(vin_number))) ... uploaded_at DESC,
-- used by the retail, conversion and accessories panels.
CREATE INDEX IF NOT EXISTS idx_kia_sales_vin_dedupe
  ON kia_sales_report ((UPPER(BTRIM(vin_number))), uploaded_at DESC);
