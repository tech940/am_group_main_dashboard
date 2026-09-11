-- 0061 — RECORD of the Accounts approval columns on fuel_approvals.
--
-- ⚠️ THESE COLUMNS ALREADY EXIST ON PRODUCTION. This file is the record, not the change.
--
-- On 2026-09-11 scripts/setup-fuel-accounts-columns.js ran this ALTER through the pgbouncer POOLER
-- (DATABASE_URL) with no migration file behind it. Measured read-only the same afternoon: all four
-- columns are present, and fuel_approvals_accounts_approved_by_fkey -> users(id) exists. Nothing in
-- lib/db/migrations said so, so a fresh database, a restore, or a branch database built from this
-- folder would have been missing them.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432, and only where the columns are missing. DDL must
-- not run on the pgbouncer pooler (6543) — which is exactly how these columns arrived the first time.
--
-- ── Safe to re-run ───────────────────────────────────────────────────────────────────────────
-- Every column is ADD COLUMN IF NOT EXISTS, so on production this is a no-op.
--
-- The foreign key is added separately, and only when no foreign key on accounts_approved_by exists.
-- It is NOT written inline (`accounts_approved_by uuid REFERENCES users(id)`) on purpose: whether
-- IF NOT EXISTS also suppresses an inline constraint when the column is already there has varied
-- across Postgres releases, and a second, identically-shaped foreign key is not an error — it would
-- sit there silently doubling every write check. The DO block below cannot add a duplicate on any
-- version, and it uses the same constraint name the setup script produced, so a fresh database ends
-- up byte-for-byte the same as production.
--
-- ── Same shape as the stage columns already on this table ────────────────────────────────────
-- uuid approver (FK to users), text name, timestamptz, text remarks — exactly ceo_*/ea_*/md_*.
-- ⚠️ The FK carries NO `ON DELETE` clause, like ceo_approved_by and ea_approved_by (ed/hr/md/rejected/
-- submitted use ON DELETE SET NULL). That is what production has and this file records it faithfully.
-- Consequence: deleting a user who stamped an Accounts approval fails with 23503 until the stamp is
-- cleared. Changing that is a separate decision, not something to smuggle into a record.
--
-- ── What reads and writes them ───────────────────────────────────────────────────────────────
-- lib/db/schema.ts (fuelApprovals.accountsApprovedBy / …Name / …At / accountsRemarks, and the
-- accountsApprover relation); app/api/fuel-approvals/[id]/action/route.ts and
-- app/api/fuel-approvals/bulk-action/route.ts stamp them on APPROVE at the 'accounts' stage and null
-- them on RESET. ⚠️ A bare Drizzle select() names EVERY column in schema.ts, so on a database without
-- these four the Fuel Approvals list, every approve/hold/reject, the bulk action, resubmit and the
-- last-fuel lookup all fail with Postgres 42703 — they do not degrade.

BEGIN;

ALTER TABLE public.fuel_approvals
  ADD COLUMN IF NOT EXISTS accounts_approved_by      uuid,
  ADD COLUMN IF NOT EXISTS accounts_approved_by_name text,
  ADD COLUMN IF NOT EXISTS accounts_approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS accounts_remarks          text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.fuel_approvals'::regclass
       AND c.contype = 'f'
       AND a.attname = 'accounts_approved_by'
  ) THEN
    ALTER TABLE public.fuel_approvals
      ADD CONSTRAINT fuel_approvals_accounts_approved_by_fkey
      FOREIGN KEY (accounts_approved_by) REFERENCES public.users(id);
  END IF;
END
$$;

COMMIT;

-- Verification (run separately) — must return FOUR rows:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'fuel_approvals' AND column_name LIKE 'accounts%'
--  ORDER BY column_name;
--
-- …and exactly ONE row, reading FOREIGN KEY (accounts_approved_by) REFERENCES users(id):
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.fuel_approvals'::regclass AND contype = 'f'
--    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (accounts_approved_by)%';
