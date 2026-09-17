-- ============================================================================================================
-- 0074 · AM Kia · Sales · Walk-in Leads (owner request, 2026-09-17)
--
-- Replaces the "AM Kia Walk In Register" Google Form. Showroom staff fill a NO-LOGIN form from a link; the
-- rows land here and are read in the dashboard section (permission kia.walk_in_leads). The sheet's history
-- (1,713 rows since Jan 2025) is imported once by scripts/import-kia-walk-in-leads.ts, idempotent on
-- (import_batch, import_row).
--
-- Customer phone / email / address are personal data: the app shows them only to MD, Developer and Finance
-- Head (lib/kia/pii.ts) and redacts them on the SERVER for everyone else.
--
-- ⚠️ Apply with scripts/apply-migration-0074.ts (session pooler, port 5432). Never on the 6543 pooler.
-- Rollback: 0074_rollback_add_kia_walk_in_leads.sql
-- ============================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.kia_walk_in_leads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_date           date NOT NULL,
  dealer_code            text NOT NULL DEFAULT 'JK402',          -- KIA showroom: JK402 Jammu, JK501 Udhampur, JK502 Banihal
  customer_name          text NOT NULL,
  country_code           text NOT NULL DEFAULT '+91',
  mobile                 text NOT NULL,                          -- digits only; imported odd lengths kept as found
  email                  text,
  address                text,
  model                  text NOT NULL,
  consultant_name        text NOT NULL,
  test_drive             boolean NOT NULL DEFAULT false,
  enquiry_source         text NOT NULL,                          -- WALK IN | REFERENCE | HYPERLOCAL | …
  customer_type          text,                                   -- NEW | EXISTING (NULL on older sheet rows)
  exchange               boolean,                                -- NULL = not asked (older sheet rows)
  exchange_details       text,
  additional_info        text,
  expected_booking_date  date,
  remarks                text,                                   -- buying intent / follow-up ("WILL PLAN", "BOOKED")
  booked                 boolean NOT NULL DEFAULT false,
  source                 text NOT NULL DEFAULT 'form',           -- form | import
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  import_batch           text,
  import_row             integer,
  updated_by             uuid REFERENCES public.users (id),
  updated_by_name        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES public.users (id),
  deleted_by_name        text,
  delete_reason          text,

  CONSTRAINT kia_walk_in_leads_name_nonblank   CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
  CONSTRAINT kia_walk_in_leads_mobile_len      CHECK (length(mobile) <= 20),
  CONSTRAINT kia_walk_in_leads_source          CHECK (source IN ('form', 'import')),
  CONSTRAINT kia_walk_in_leads_customer_type   CHECK (customer_type IS NULL OR customer_type IN ('NEW', 'EXISTING')),
  CONSTRAINT kia_walk_in_leads_text_sizes      CHECK (
    length(coalesce(email, '')) <= 160 AND length(coalesce(address, '')) <= 500
    AND length(coalesce(additional_info, '')) <= 1000 AND length(coalesce(remarks, '')) <= 500
    AND length(coalesce(exchange_details, '')) <= 200
  ),
  CONSTRAINT kia_walk_in_leads_import_pair     CHECK ((import_batch IS NULL) = (import_row IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS kia_walk_in_leads_import_key
  ON public.kia_walk_in_leads (import_batch, import_row) WHERE import_batch IS NOT NULL;
CREATE INDEX IF NOT EXISTS kia_walk_in_leads_enquiry_date_idx
  ON public.kia_walk_in_leads (enquiry_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS kia_walk_in_leads_mobile_idx
  ON public.kia_walk_in_leads (mobile) WHERE deleted_at IS NULL;

ALTER TABLE public.kia_walk_in_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_walk_in_leads FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.kia_walk_in_leads TO service_role;

COMMIT;

-- Verification (scripts/apply-migration-0074.ts runs these):
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'kia_walk_in_leads';                              -- true
-- SELECT grantee FROM information_schema.role_table_grants
--  WHERE table_name = 'kia_walk_in_leads' AND grantee IN ('anon','authenticated','PUBLIC');             -- ZERO rows
