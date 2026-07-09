-- Add the new "Service General Manager" role. The existing "general_manager" is now
-- labelled "Sales General Manager" in the UI (its enum value is unchanged, so the
-- proforma approval chain is unaffected). Run after a backup — enum DDL is blocked in-app.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- Postgres. If your client wraps this in a transaction and errors, run the single
-- statement on its own.

ALTER TYPE role ADD VALUE IF NOT EXISTS 'service_general_manager';
