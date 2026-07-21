-- ============================================================================
-- KIA generic-table rename — STEP 1: kia_-prefixed compatibility VIEWS (Category A)
-- ============================================================================
-- Companion to docs/kia-generic-table-rename-candidates.md
--
-- WHAT: creates a `kia_<name>` VIEW over each generic, externally-ingested KIA report
-- table, so application code can migrate to clean, brand-prefixed names WITHOUT touching
-- the off-repo DMS ingestion pipeline (which still writes the physical bare tables).
--
-- WHY A VIEW: the app only SELECTs these tables; the pipeline owns the writes. A view is
-- zero-copy, uses the base table's indexes, and is fully reversible (DROP VIEW). The
-- physical RENAME is deferred until the external loader can be updated in lockstep — or
-- skipped entirely if the view is sufficient.
--
-- SAFE + IDEMPOTENT: CREATE OR REPLACE VIEW; base tables that don't exist yet (e.g.
-- psf_yearly, which is a March-2026 feed) are skipped with a NOTICE. Run in the Supabase
-- SQL editor or via a direct connection. No data is moved and no existing object changes.
--
-- ORDER OF OPERATIONS: run THIS first, verify the views resolve, THEN deploy the code that
-- reads the kia_ names (see the service_appointment template in the companion doc). Do not
-- deploy the code before the views exist, or the queries will error at runtime.
--
-- CAVEAT (SELECT *): a view's column list is fixed at creation. If the pipeline adds a
-- NEW column to a base table, re-run this script so the view picks it up. Existing columns
-- (everything the app reads today) are unaffected.
-- ============================================================================

DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('ro_billing_report',                     'kia_ro_billing_report'),
      ('open_ro_yearly',                        'kia_open_ro_yearly'),
      ('operation_wise_analysis_report',        'kia_operation_wise_analysis_report'),
      ('operation_wise_analysis_advisor_report','kia_operation_wise_analysis_advisor_report'),
      ('ew_report',                             'kia_ew_report'),
      ('rsa_report',                            'kia_rsa_report'),
      ('mcp_report',                            'kia_mcp_report'),
      ('adv_wise_lubricants_vas',               'kia_adv_wise_lubricants_vas'),
      ('service_appointment',                   'kia_service_appointment'),
      ('demo_job_cards',                        'kia_demo_job_cards'),
      ('demo_car_list',                         'kia_demo_car_list'),
      ('psf_yearly',                            'kia_psf_yearly')
    ) AS t(base, view_name)
  LOOP
    IF to_regclass('public.' || m.base) IS NULL THEN
      RAISE NOTICE 'skip % -> % (base table not found)', m.base, m.view_name;
      CONTINUE;
    END IF;

    -- security_invoker so the view enforces the CALLER's RLS/grants (Postgres 15+, Supabase
    -- qualifies), matching each base table's own posture. Server reads go through the service
    -- role (bypasses RLS + has SELECT on the base), so the app is unaffected.
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker = on) AS SELECT * FROM public.%I',
                   m.view_name, m.base);

    -- Match the base tables' PostgREST posture: readable by the app roles, NOT by anon/
    -- authenticated (these analytics tables were locked down in supabase-security-linter-fixes.sql).
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', m.view_name);
    EXECUTE format('GRANT SELECT ON public.%I TO postgres, service_role', m.view_name);

    RAISE NOTICE 'created view % -> %', m.view_name, m.base;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verify: every expected view should resolve (skipped ones = base not loaded yet).
-- ---------------------------------------------------------------------------
--   SELECT c.relname AS view_name, c.relkind
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname LIKE 'kia_%' AND c.relkind = 'v'
--    ORDER BY c.relname;
--
-- Smoke-test one:
--   SELECT count(*) FROM public.kia_ro_billing_report;   -- should equal ro_billing_report

-- ---------------------------------------------------------------------------
-- Rollback (no data impact):
--   DROP VIEW IF EXISTS public.kia_ro_billing_report, public.kia_open_ro_yearly, … ;
-- ---------------------------------------------------------------------------
