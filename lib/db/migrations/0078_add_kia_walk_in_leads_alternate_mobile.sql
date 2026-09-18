-- ============================================================================================================
-- 0078 · AM Kia · Sales · Walk-in Leads Alternate Mobile Number (User request, 2026-09-18)
--
-- Adds:
-- 1. alternate_mobile (text) — Optional secondary contact number for the customer
--
-- ============================================================================================================

BEGIN;

ALTER TABLE public.kia_walk_in_leads
  ADD COLUMN IF NOT EXISTS alternate_mobile text;

COMMIT;
