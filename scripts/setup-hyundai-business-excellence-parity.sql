-- Hyundai Business Excellence parity indexes.
-- Safe to run repeatedly after the Hyundai source tables are present.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION hyundai_normalize_active_dealer_code(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(TRIM(COALESCE(value, '')))
    WHEN 'N5203' THEN 'N5216'
    WHEN 'N5701' THEN 'N6844'
    WHEN 'N5804' THEN 'N6845'
    WHEN 'N6815' THEN 'N6846'
    WHEN 'N6819' THEN 'N6847'
    WHEN 'N6826' THEN 'N6848'
    WHEN 'N6828' THEN 'N6848'
    ELSE value
  END
$$;

CREATE OR REPLACE FUNCTION hyundai_ro_billing_safe_hash_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.source_dealer_code := hyundai_normalize_active_dealer_code(NEW.source_dealer_code);
  NEW.dealer_code := hyundai_normalize_active_dealer_code(NEW.dealer_code);
  NEW.main_dealer_code := hyundai_normalize_active_dealer_code(NEW.main_dealer_code);
  NEW.dealer_code_2 := hyundai_normalize_active_dealer_code(NEW.dealer_code_2);
  NEW.row_hash := encode(
    digest((((to_jsonb(NEW) - 'id') - 'row_hash') - 'uploaded_at')::text, 'sha256'),
    'hex'
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION hyundai_repair_order_safe_hash_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.source_dealer_code := hyundai_normalize_active_dealer_code(NEW.source_dealer_code);
  NEW.dealer_code := hyundai_normalize_active_dealer_code(NEW.dealer_code);
  NEW.dlr_no := hyundai_normalize_active_dealer_code(NEW.dlr_no);
  NEW.dealer_code_2 := hyundai_normalize_active_dealer_code(NEW.dealer_code_2);
  NEW.sale_dealer_code := hyundai_normalize_active_dealer_code(NEW.sale_dealer_code);
  IF UPPER(TRIM(COALESCE(NEW.dealer, ''))) ~ '^N[0-9]+$' THEN
    NEW.dealer := hyundai_normalize_active_dealer_code(NEW.dealer);
  END IF;
  NEW.row_hash := encode(
    digest((((to_jsonb(NEW) - 'id') - 'row_hash') - 'uploaded_at')::text, 'sha256'),
    'hex'
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION hyundai_operation_safe_hash_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.source_dealer_code := hyundai_normalize_active_dealer_code(NEW.source_dealer_code);
  NEW.dealer_code := hyundai_normalize_active_dealer_code(NEW.dealer_code);
  NEW.row_hash := encode(
    digest((((to_jsonb(NEW) - 'id') - 'row_hash') - 'uploaded_at')::text, 'sha256'),
    'hex'
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS hyundai_ro_billing_safe_hash ON hyundai_ro_billing_report;
CREATE TRIGGER hyundai_ro_billing_safe_hash
BEFORE INSERT OR UPDATE ON hyundai_ro_billing_report
FOR EACH ROW EXECUTE FUNCTION hyundai_ro_billing_safe_hash_trigger();

DROP TRIGGER IF EXISTS hyundai_repair_order_safe_hash ON hyundai_repair_order_list;
CREATE TRIGGER hyundai_repair_order_safe_hash
BEFORE INSERT OR UPDATE ON hyundai_repair_order_list
FOR EACH ROW EXECUTE FUNCTION hyundai_repair_order_safe_hash_trigger();

DROP TRIGGER IF EXISTS hyundai_operation_safe_hash ON hyundai_operation_wise_analysis_report;
CREATE TRIGGER hyundai_operation_safe_hash
BEFORE INSERT OR UPDATE ON hyundai_operation_wise_analysis_report
FOR EACH ROW EXECUTE FUNCTION hyundai_operation_safe_hash_trigger();

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_active_date_dealer_idx
  ON hyundai_ro_billing_report (
    bill_date,
    UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''))))
  )
  WHERE LOWER(TRIM(COALESCE(bill_type, ''))) NOT LIKE '%cancel%';

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_invoice_dedup_idx
  ON hyundai_ro_billing_report (
    bill_date,
    bill_no,
    r_o_no,
    uploaded_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_ro_billing_ro_idx
  ON hyundai_ro_billing_report (r_o_no, bill_date, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS hyundai_repair_order_open_dealer_date_idx
  ON hyundai_repair_order_list (
    UPPER(TRIM(COALESCE(dealer, ''))),
    r_o_date,
    uploaded_at DESC
  )
  WHERE LOWER(TRIM(COALESCE(r_o_status, ''))) = 'open';

CREATE INDEX IF NOT EXISTS hyundai_operation_period_dealer_idx
  ON hyundai_operation_wise_analysis_report (
    report_period_start,
    report_period_end,
    UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, '')))),
    uploaded_at DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_operation_row_hash_idx
  ON hyundai_operation_wise_analysis_report (row_hash, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS hyundai_complaints_business_date_idx
  ON hyundai_call_center_complaints (
    (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)),
    UPPER(TRIM(COALESCE(source_dealer_code, ''))),
    uploaded_at DESC
  );

CREATE INDEX IF NOT EXISTS hyundai_ew_service_date_dealer_idx
  ON hyundai_ew_report (reg_date, UPPER(TRIM(COALESCE(dlr_no, ''))), uploaded_at DESC)
  WHERE LOWER(TRIM(COALESCE(department, ''))) = 'service';
