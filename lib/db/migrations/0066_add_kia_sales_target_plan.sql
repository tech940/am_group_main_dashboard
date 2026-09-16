-- 0066 — Sales Target Plan: the two funnel targets the table was missing, and the team grouping
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- KIA Jammu plans its month in a 36-sheet workbook ("KIA JAMMU SALES TARGET PLG.xlsx"). Measured
-- against the live feed, ~95% of that workbook is ACTUALS re-typed from the DMS export the dashboard
-- already reads every morning — for September 2026 the sheet's booking count and the deduplicated
-- feed agree exactly (27 = 27). What is genuinely NOT anywhere in this database is the part staff
-- decide rather than observe:
--
--   1. targets for the TOP of the funnel — enquiries and test drives. `kia_sales_targets` has only
--      booking_target and delivery_target, so the two numbers the daily meeting actually pushes on
--      had no home;
--   2. the TEAM each consultant reports to. The workbook groups 13 Jammu consultants under four team
--      leaders and sub-totals by team. That grouping exists in no table, no feed and no HR record.
--
-- ── Columns ───────────────────────────────────────────────────────────────────────────────────
--   enquiry_target     — fresh enquiries the consultant is to open this month
--   test_drive_target  — test drives to be given this month
--   team_leader        — free text, nullable. NULL means "not assigned to a team", which must stay a
--                        legitimate state: a new joiner appears in the feed the day their first
--                        enquiry lands, and must never be blocked from having a target because
--                        nobody has slotted them into a team yet.
--
-- ⚠️ NO `retail_target` COLUMN. `delivery_target` already IS the retail target — retail for KIA is
-- `kia_sales_report.delivery_date` (reconciled 12 of 14 months against the MD's own deck; invoice_date
-- matched 1 of 14). Adding a second column named for the same fact is how `status` + `current_stage`
-- started. The UI labels the existing column "Retails".
--
-- ── Lockdown ──────────────────────────────────────────────────────────────────────────────────
-- ⚠️ This table was created without one. `anon` currently holds SELECT/INSERT/UPDATE/DELETE/TRUNCATE
-- on it — the public browser key can rewrite every sales target in the company. RLS is on, which
-- blocks it in practice, but a single permissive policy added later would open it silently. The
-- grants are revoked here so the block does not depend on policy hygiene.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

ALTER TABLE public.kia_sales_targets
  ADD COLUMN IF NOT EXISTS enquiry_target    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_drive_target integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS team_leader       text;

-- Every read is (dealer, year, month) — the whole month for one outlet, then joined to the feed in
-- JavaScript. The existing unique index leads with dealer_code + consultant_name, so it cannot serve
-- that prefix.
CREATE INDEX IF NOT EXISTS kia_sales_targets_period_idx
  ON public.kia_sales_targets (dealer_code, year, month);

ALTER TABLE public.kia_sales_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_sales_targets FROM anon;
REVOKE ALL ON public.kia_sales_targets FROM PUBLIC;
GRANT ALL ON public.kia_sales_targets TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'kia_sales_targets'
--    AND column_name IN ('enquiry_target', 'test_drive_target', 'team_leader');
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'kia_sales_targets' AND grantee = 'anon';   -- must return 0 rows
