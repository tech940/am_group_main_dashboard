CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mg_user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  consultant_name text NOT NULL,
  dealer_location text,
  employee_code text,
  status text NOT NULL DEFAULT 'NEW USER',
  approver boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}',
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mg_user_profiles_auth_user_idx ON mg_user_profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS mg_user_profiles_approver_idx ON mg_user_profiles(approver);
CREATE INDEX IF NOT EXISTS mg_user_profiles_status_idx ON mg_user_profiles(status);

CREATE TABLE IF NOT EXISTS mg_price_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model text NOT NULL,
  trim_description text NOT NULL,
  colour text,
  hyp text,
  bank_name text,
  bank_branch text,
  ex_showroom_price numeric(14, 2) NOT NULL DEFAULT 0,
  tcs numeric(14, 2) NOT NULL DEFAULT 0,
  registration_charges numeric(14, 2) NOT NULL DEFAULT 0,
  statutory_charges numeric(14, 2) NOT NULL DEFAULT 0,
  insurance numeric(14, 2) NOT NULL DEFAULT 0,
  fastag numeric(14, 2) NOT NULL DEFAULT 0,
  accessories_kit numeric(14, 2) NOT NULL DEFAULT 0,
  extended_warranty_4th_year numeric(14, 2) NOT NULL DEFAULT 0,
  insurance_company text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mg_price_details_model_trim_idx ON mg_price_details(model, trim_description, colour);
CREATE INDEX IF NOT EXISTS mg_price_details_bank_idx ON mg_price_details(bank_name, bank_branch);
CREATE INDEX IF NOT EXISTS mg_price_details_insurance_idx ON mg_price_details(insurance_company);

CREATE TABLE IF NOT EXISTS mg_proforma_lookup_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  value text NOT NULL,
  label text,
  source_sheet text,
  source_row integer,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mg_proforma_lookup_options_category_idx ON mg_proforma_lookup_options(category);
CREATE INDEX IF NOT EXISTS mg_proforma_lookup_options_value_idx ON mg_proforma_lookup_options(value);

CREATE TABLE IF NOT EXISTS mg_proformas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_time timestamptz NOT NULL DEFAULT now(),
  proforma_date timestamptz NOT NULL,
  customer_type text NOT NULL DEFAULT 'Customer',
  customer_name text NOT NULL,
  mobile_number text NOT NULL,
  customer_address text NOT NULL,
  customer_email text NOT NULL DEFAULT '',
  model_name text NOT NULL,
  trim_description text NOT NULL,
  fuel_type text NOT NULL,
  vehicle_color text NOT NULL,
  bank_name text NOT NULL,
  bank_branch text,
  vehicle_status text NOT NULL DEFAULT 'UNKNOWN',
  loan_amount numeric(14, 2) NOT NULL DEFAULT 0,
  insurance_company text,
  ex_showroom numeric(14, 2) NOT NULL DEFAULT 0,
  tcs_value numeric(14, 2) NOT NULL DEFAULT 0,
  registration_charges numeric(14, 2) NOT NULL DEFAULT 0,
  insurance_value numeric(14, 2) NOT NULL DEFAULT 0,
  fastag_value numeric(14, 2) NOT NULL DEFAULT 0,
  accessories_kit numeric(14, 2) NOT NULL DEFAULT 0,
  ext_warranty numeric(14, 2) NOT NULL DEFAULT 0,
  cash_discount numeric(14, 2) NOT NULL DEFAULT 0,
  exchange_value numeric(14, 2) NOT NULL DEFAULT 0,
  booking_amount numeric(14, 2) NOT NULL DEFAULT 0,
  govt_employee_discount numeric(14, 2) NOT NULL DEFAULT 0,
  additional_discount numeric(14, 2) NOT NULL DEFAULT 0,
  total_customer_cost numeric(14, 2) NOT NULL DEFAULT 0,
  grand_total_cost numeric(14, 2) NOT NULL DEFAULT 0,
  login_email text NOT NULL,
  consultant text NOT NULL,
  location text,
  emp_code text,
  approval_status text NOT NULL DEFAULT 'PENDING',
  approved_by text,
  checked_by text,
  email_send_status text,
  link_preview text,
  finance_status text DEFAULT 'Pending',
  finance_remarks text,
  finance_updated_time timestamptz,
  add_disc_approval jsonb NOT NULL DEFAULT '{}',
  import_metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS mg_proformas_login_email_idx ON mg_proformas(login_email);
CREATE INDEX IF NOT EXISTS mg_proformas_proforma_date_idx ON mg_proformas(proforma_date);
CREATE INDEX IF NOT EXISTS mg_proformas_approval_status_idx ON mg_proformas(approval_status);
CREATE INDEX IF NOT EXISTS mg_proformas_finance_status_idx ON mg_proformas(finance_status);
CREATE INDEX IF NOT EXISTS mg_proformas_customer_idx ON mg_proformas(customer_name, mobile_number);

ALTER TABLE mg_price_details ADD COLUMN IF NOT EXISTS colour text;
ALTER TABLE mg_price_details ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE mg_proformas ADD COLUMN IF NOT EXISTS import_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE mg_proformas ADD COLUMN IF NOT EXISTS checked_by text;
ALTER TABLE mg_proformas ADD COLUMN IF NOT EXISTS email_send_status text;
ALTER TABLE mg_proformas ALTER COLUMN customer_type SET DEFAULT 'Customer';
ALTER TABLE mg_proformas ALTER COLUMN customer_email SET DEFAULT '';
ALTER TABLE mg_proformas ALTER COLUMN vehicle_status SET DEFAULT 'UNKNOWN';
DROP INDEX IF EXISTS mg_price_details_model_trim_idx;
CREATE INDEX IF NOT EXISTS mg_price_details_model_trim_idx ON mg_price_details(model, trim_description, colour);

ALTER TABLE mg_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mg_price_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE mg_proformas ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mg_proforma_is_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    LEFT JOIN mg_user_profiles p ON p.email = u.email
    WHERE u.supabase_id = auth.uid()::text
      AND (u.role IN ('admin', 'ceo', 'md', 'ea', 'manager') OR COALESCE(p.approver, false))
  );
$$;

DROP POLICY IF EXISTS "mg_user_profiles_read_self_or_approver" ON mg_user_profiles;
CREATE POLICY "mg_user_profiles_read_self_or_approver"
ON mg_user_profiles FOR SELECT
USING (
  email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
);

DROP POLICY IF EXISTS "mg_user_profiles_update_self_or_approver" ON mg_user_profiles;
CREATE POLICY "mg_user_profiles_update_self_or_approver"
ON mg_user_profiles FOR UPDATE
USING (
  email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
)
WITH CHECK (
  email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
);

DROP POLICY IF EXISTS "mg_price_details_read_authenticated" ON mg_price_details;
CREATE POLICY "mg_price_details_read_authenticated"
ON mg_price_details FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "mg_proformas_read_own_or_approver" ON mg_proformas;
CREATE POLICY "mg_proformas_read_own_or_approver"
ON mg_proformas FOR SELECT
USING (
  login_email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
);

DROP POLICY IF EXISTS "mg_proformas_insert_own" ON mg_proformas;
CREATE POLICY "mg_proformas_insert_own"
ON mg_proformas FOR INSERT
WITH CHECK (login_email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1));

DROP POLICY IF EXISTS "mg_proformas_update_own_or_approver" ON mg_proformas;
CREATE POLICY "mg_proformas_update_own_or_approver"
ON mg_proformas FOR UPDATE
USING (
  login_email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
)
WITH CHECK (
  login_email = (SELECT email FROM users WHERE supabase_id = auth.uid()::text LIMIT 1)
  OR public.mg_proforma_is_approver()
);
