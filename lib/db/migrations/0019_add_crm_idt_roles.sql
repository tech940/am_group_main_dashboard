-- 0019 — add the CRM and IDT roles.
-- NOT applied by drizzle-kit: ALTER TYPE ... ADD VALUE cannot run inside a transaction block, and
-- drizzle wraps migrations in one. Apply with `npx tsx scripts/apply-migration-0019.ts`, which issues
-- each statement separately in autocommit.
--
-- crm = Customer Relationship Manager — the only operational role that may mark a vehicle Delivered.
-- idt = Internal Development Trainee — the only operational role that may allot a vehicle to a booking.
-- Both are deny-by-default (family 'special', TEMPLATE_ONLY_ROLES) — see lib/permissions/tiers.ts.
ALTER TYPE role ADD VALUE IF NOT EXISTS 'crm';
ALTER TYPE role ADD VALUE IF NOT EXISTS 'idt';
