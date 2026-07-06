-- Adds the KIA Proforma workflow roles.
-- Run in Supabase SQL Editor (these are additive and safe; ADD VALUE cannot run
-- inside a single transaction that also uses the value, so run as-is).
ALTER TYPE role ADD VALUE IF NOT EXISTS 'sales_executive';
ALTER TYPE role ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE role ADD VALUE IF NOT EXISTS 'finance_team';
