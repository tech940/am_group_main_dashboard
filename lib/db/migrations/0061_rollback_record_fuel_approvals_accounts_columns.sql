-- ROLLBACK of 0061 — the Accounts approval columns on fuel_approvals.
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- This drops who approved a fuel request at the Accounts stage, when, and what they wrote. Zero rows
-- carried an Accounts stamp when 0061 was written (2026-09-11), but the approve and bulk-approve
-- routes write these columns the moment a request reaches that stage, so check before trusting that.
--
-- ⚠️ DO NOT RUN THIS WHILE THE CODE STILL NAMES THE COLUMNS.
-- 0061 did not create them — scripts/setup-fuel-accounts-columns.js did, and the code already depends
-- on them. A bare Drizzle select() names every column in lib/db/schema.ts, so dropping these without
-- reverting the code takes down the Fuel Approvals list, every approve/hold/reject, the bulk action,
-- resubmit and the last-fuel lookup with Postgres 42703. Revert first:
--   - the four accounts* columns and the accountsApprover relation in lib/db/schema.ts (fuelApprovals)
--   - the 'accounts' branches in app/api/fuel-approvals/[id]/action/route.ts and
--     app/api/fuel-approvals/bulk-action/route.ts (APPROVE stamp and RESET clear)
--   - the accounts* fields in lib/fuel-approvals/types.ts
--
-- EXPORT FIRST. From psql on the direct/session port (5432), not the pooler:
--
--   \copy (SELECT id, request_number, status, current_stage, accounts_approved_by, accounts_approved_by_name, accounts_approved_at, accounts_remarks FROM public.fuel_approvals WHERE accounts_approved_by IS NOT NULL OR accounts_approved_at IS NOT NULL OR accounts_remarks IS NOT NULL ORDER BY request_number) TO 'fuel_approvals_accounts_stamps.csv' WITH CSV HEADER
--
-- The history jsonb on each row keeps its own APPROVE@accounts entries; this does not touch them.

BEGIN;

-- Dropping accounts_approved_by also drops fuel_approvals_accounts_approved_by_fkey with it.
ALTER TABLE public.fuel_approvals
  DROP COLUMN IF EXISTS accounts_remarks,
  DROP COLUMN IF EXISTS accounts_approved_at,
  DROP COLUMN IF EXISTS accounts_approved_by_name,
  DROP COLUMN IF EXISTS accounts_approved_by;

COMMIT;

-- Verification (run separately) — must return ZERO rows:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'fuel_approvals' AND column_name LIKE 'accounts%';
