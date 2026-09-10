-- 0059 — Fix Supabase Security Linter Errors across all flagged public tables.
--
-- ⚠️ APPLY ON DIRECT SESSION PORT 5432 (or execute via migration runner).
-- Resolves:
-- 1. policy_exists_rls_disabled (tables with RLS policies but rowsecurity = false):
--    - public.am_hyundai_trips
--    - public.items_row
--    - public.mg_trips
--    - public.platinum_test_drive_vehicle
--    - public.trips
-- 2. rls_disabled_in_public (tables in public schema with RLS disabled):
--    - public.platinum_test_drive_vehicle
--    - public.mg_trips
--    - public.kia_vehicle
--    - public.TATA_employees
--    - public.kia_employees
--    - public.items_row
--    - public.tata_trips
--    - public.trips
--    - public.kia_trips
--    - public.am_hyundai_trips
--    - public.TATA_vehicle
-- 3. sensitive_columns_exposed (password columns exposed to API):
--    - public.TATA_employees (password)
--    - public.kia_employees (password)

BEGIN;

-- ============================================================================
-- 1. Enable & Force Row Level Security (RLS) on all 11 flagged tables
-- ============================================================================
ALTER TABLE IF EXISTS public.am_hyundai_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.am_hyundai_trips FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.items_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.items_row FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.mg_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.mg_trips FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.platinum_test_drive_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platinum_test_drive_vehicle FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trips FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.kia_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kia_vehicle FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public."TATA_employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."TATA_employees" FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.kia_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kia_employees FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.tata_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tata_trips FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.kia_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kia_trips FORCE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public."TATA_vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."TATA_vehicle" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Clean up insecure anonymous / public policies
-- ============================================================================
DROP POLICY IF EXISTS "Enable delete for anon on items" ON public.items_row;
DROP POLICY IF EXISTS "Enable read for anon" ON public.items_row;
DROP POLICY IF EXISTS "Enable update for anon on items" ON public.items_row;
DROP POLICY IF EXISTS "anon_insert" ON public.items_row;
DROP POLICY IF EXISTS "Allow anon all access on mg_trips" ON public.mg_trips;

-- ============================================================================
-- 3. Revoke public & anon permissions to prevent unauthenticated data exposure
-- ============================================================================
REVOKE ALL ON TABLE public.am_hyundai_trips FROM anon, public;
REVOKE ALL ON TABLE public.items_row FROM anon, public;
REVOKE ALL ON TABLE public.mg_trips FROM anon, public;
REVOKE ALL ON TABLE public.platinum_test_drive_vehicle FROM anon, public;
REVOKE ALL ON TABLE public.trips FROM anon, public;
REVOKE ALL ON TABLE public.kia_vehicle FROM anon, public;
REVOKE ALL ON TABLE public."TATA_employees" FROM anon, public;
REVOKE ALL ON TABLE public.kia_employees FROM anon, public;
REVOKE ALL ON TABLE public.tata_trips FROM anon, public;
REVOKE ALL ON TABLE public.kia_trips FROM anon, public;
REVOKE ALL ON TABLE public."TATA_vehicle" FROM anon, public;

-- ============================================================================
-- 4. Protect sensitive password columns on employee tables
-- Revoke SELECT on password column from authenticated role
-- ============================================================================
REVOKE SELECT (password) ON TABLE public."TATA_employees" FROM authenticated;
REVOKE SELECT (password) ON TABLE public.kia_employees FROM authenticated;

COMMIT;

-- Reload PostgREST schema cache so linter and API update immediately
NOTIFY pgrst, 'reload schema';
