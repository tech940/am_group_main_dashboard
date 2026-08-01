-- 0031: Add the `hr` role enum value.
--
-- The role was added to lib/db/schema.ts roleEnum and all auth/permissions files but the
-- Postgres enum was never updated, causing insert failures with error 22P02 whenever
-- a user with role='hr' was created.
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so this is applied
-- standalone by scripts/apply-migration-0031.ts (not drizzle-kit). Idempotent via IF NOT EXISTS.
ALTER TYPE role ADD VALUE IF NOT EXISTS 'hr';
