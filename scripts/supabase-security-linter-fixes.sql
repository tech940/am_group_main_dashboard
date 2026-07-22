-- Supabase Database Linter security remediation.
-- Run in Supabase SQL Editor during low traffic (RLS section revokes PostgREST access).
--
-- Pre-flight (required before RLS hardening):
--   SELECT current_user,
--          (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls;
-- Drizzle/service role must bypass RLS or server queries on analytics tables will fail.
--
-- Rollback: export policies before running; restore via pg_get_functiondef(oid) for functions.

-- ============================================================================
-- 1. Function search_path (lint 0011)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_purchase_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  date_part TEXT;
  sequence_part TEXT;
  next_sequence INTEGER;
BEGIN
  date_part := TO_CHAR(timezone('Asia/Kolkata', NOW()), 'YYYYMMDD');

  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 13) AS INTEGER)), 0) + 1
  INTO next_sequence
  FROM purchase_orders
  WHERE order_number LIKE 'PO-' || date_part || '-%';

  sequence_part := LPAD(next_sequence::TEXT, 3, '0');

  RETURN 'PO-' || date_part || '-' || sequence_part;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_workflow_action(
    p_purchase_order_id UUID,
    p_action TEXT,
    p_stage TEXT,
    p_performed_by UUID,
    p_user_role TEXT,
    p_remarks TEXT DEFAULT NULL,
    p_previous_status TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_history_id UUID;
BEGIN
    INSERT INTO workflow_history (
        purchase_order_id,
        action,
        stage,
        performed_by,
        user_role,
        remarks,
        previous_status,
        new_status,
        metadata
    ) VALUES (
        p_purchase_order_id,
        p_action,
        p_stage,
        p_performed_by,
        p_user_role,
        p_remarks,
        p_previous_status,
        p_new_status,
        p_metadata
    ) RETURNING id INTO v_history_id;

    RETURN v_history_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.kia_proforma_is_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    LEFT JOIN kia_user_profiles p ON p.email = u.email
    WHERE u.supabase_id = auth.uid()::text
      AND (u.role IN ('admin', 'ceo', 'md', 'ea', 'manager') OR COALESCE(p.approver, false))
  );
$$;

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

CREATE OR REPLACE FUNCTION public.set_demo_vehicle_remarks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Move pg_trgm out of public (extension-in-public lint)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm schema move skipped: %. Recreate manually if needed.', SQLERRM;
END $$;

GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- ============================================================================
-- 3. rls_auto_enable() SECURITY DEFINER exposure
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- ============================================================================
-- 4. RLS policies always true — deny PostgREST exposure (app uses Drizzle)
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'activity_logs',
    'attachments',
    'comments',
    'inventory_items',
    'inventory_transactions',
    'permissions',
    'recon_workflows',
    'tasks',
    'vehicles',
    'workshop_jobs',
    'ew_report',
    'kia_call_center_complaints',
    'mcp_report',
    'open_ro_yearly',
    'psf_yearly',
    'ro_billing_report',
    'rsa_report',
    'test_drive_employees',
    'trips',
    'employees',
    'platinum_test_drive_vehicle'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE NOTICE 'Skipping % (table not found)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Authenticated users can do everything', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all access', tbl);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);

    EXECUTE format('GRANT ALL ON public.%I TO postgres, service_role', tbl);
  END LOOP;
END $$;

-- ============================================================================
-- 5. SECURITY DEFINER view → security_invoker (lint 0010)
-- ============================================================================
-- am_platinum_service_appointment_resolved_v1 is a plain view; without security_invoker it enforces
-- the view OWNER's permissions/RLS instead of the querying role's. Switch it to invoker semantics so
-- PostgREST/API callers only see what their own role allows. Safe for the app: server reads go through
-- the service role (bypasses RLS + has SELECT on the base table am_platinum_service_appointment), and
-- the materialized views built on it refresh as their owner. Requires Postgres 15+ (Supabase qualifies).
-- The view's source-of-truth definition lives in scripts/platinum-business-excellence-performance.sql.

DO $$
BEGIN
  IF to_regclass('public.am_platinum_service_appointment_resolved_v1') IS NOT NULL THEN
    ALTER VIEW public.am_platinum_service_appointment_resolved_v1 SET (security_invoker = on);
  END IF;
END $$;

-- ============================================================================
-- 6. Enable RLS on Public Tables (lint 0013 & 0023)
-- ============================================================================
ALTER TABLE IF EXISTS public.am_hyundai_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.am_hyundai_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.am_hyundai_employees ENABLE ROW LEVEL SECURITY;

-- Post-run verification:
--   Re-run Supabase Database Linter; function search_path, RLS, and security-definer-view warnings should clear.
--   Smoke-test: Kia/Hyundai/Platinum analytics APIs, purchase orders, proforma flows.
--
-- Manual (Supabase Dashboard — cannot be applied via SQL):
--   Authentication → Providers → Email → Enable leaked password protection
--   https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
