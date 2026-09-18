-- ============================================================================================================
-- 0075 · AM Kia · Sales · Walk-in Leads Follow-up & Forecasting Fields (MD request, 2026-09-18)
--
-- Adds:
-- 1. follow_up_date (date) — Next follow-up commitment date (default: enquiry_date + 2 days)
-- 2. holding_reason (text) — What is holding them back (Discussing with family, Waiting for price, etc.)
-- 3. expected_booking_timeline (text) — Forecasting timeline chip selection (Booked today, Within 7 days, etc.)
--
-- Rollback: 0075_rollback_update_kia_walk_in_leads_followup.sql
-- ============================================================================================================

BEGIN;

ALTER TABLE public.kia_walk_in_leads
  ADD COLUMN IF NOT EXISTS follow_up_date date,
  ADD COLUMN IF NOT EXISTS holding_reason text,
  ADD COLUMN IF NOT EXISTS expected_booking_timeline text;

CREATE INDEX IF NOT EXISTS kia_walk_in_leads_follow_up_date_idx
  ON public.kia_walk_in_leads (follow_up_date ASC) WHERE deleted_at IS NULL;

COMMIT;
