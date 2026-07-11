-- 0012: Add the read-only "CA" (Chartered Accountant) role.
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, so this is applied
-- standalone by scripts/apply-migration-0012.ts (not drizzle-kit). Idempotent via IF NOT EXISTS.
ALTER TYPE role ADD VALUE IF NOT EXISTS 'ca';
