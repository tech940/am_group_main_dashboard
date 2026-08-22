-- Complete rollback for 0039_add_approval_request_numbers.sql.
--
-- Kept alongside the migration because `npm run db:backup` currently cannot run on every machine
-- (it needs PostgreSQL client tools installed locally, and they are not everywhere). This is the
-- safety net in their place — and for THIS migration it is a complete one.
--
-- ── Why a backup is not strictly required for 0039 ────────────────────────────────────────────
-- Every statement in 0039 is ADDITIVE. Read it again and note what is absent: there is no DROP, no
-- ALTER of an existing column, and no UPDATE that writes to a pre-existing column. The one UPDATE
-- populates `request_no` — a column the same migration just created — on rows WHERE request_no IS
-- NULL. No byte of existing approval data is read for modification or overwritten.
--
-- So the failure modes are limited to: the new column exists and is populated, or it does not.
-- Both are undone completely by the four statements below, which return the schema to exactly its
-- prior shape. That is a materially different risk profile from a migration that rewrites data,
-- where a dump is genuinely the only way back.
--
-- ⚠️ This does NOT generalise. Any future migration that touches existing columns still needs a
-- real backup, and `npm run db:backup` should be made to work before then.
--
-- Run against the direct/session port — DDL does not run through the pgbouncer transaction pooler.

DROP INDEX IF EXISTS idx_kia_approval_requests_request_no_lookup;
DROP INDEX IF EXISTS idx_kia_approval_requests_request_no;

ALTER TABLE kia_approval_requests
  DROP COLUMN IF EXISTS request_no;

DROP TABLE IF EXISTS approval_number_counters;

-- Verify the rollback landed — both should report 0.
-- SELECT
--   (SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='kia_approval_requests'
--       AND column_name='request_no')                                  AS column_remaining,
--   (to_regclass('public.approval_number_counters') IS NOT NULL)::int   AS counters_remaining;
