-- 0067 — KIA sales commitments become DAILY
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- Owner decision, 2026-09-16: "commitment will be on daily basis not monthly basis", and what a
-- consultant ACHIEVES is never typed — it is read from the DMS report feeds the Sales Report section
-- already reads (kia_enquiry_report / kia_booking_report / kia_sales_report).
--
-- That is how the dealership actually runs the month. The workbook this replaces already had it:
-- "Daywise Tracking Format" carries one row per consultant per metric across 31 day columns, and
-- "Daywise Performance" carries a target and an achieved figure for every date. A single monthly
-- number cannot answer "what did you commit to for today", which is the question the morning meeting
-- asks.
--
-- ── One row per consultant per day ────────────────────────────────────────────────────────────
-- The month's commitment is SUM(days), derived — never stored a second time. Storing both is the
-- `status` + `current_stage` defect that made purchase orders unmaintainable, and it would drift the
-- first time somebody edited one day.
--
-- ⚠️ commitment_date IS A `date`, NOT A TIMESTAMP. Every consumer works in IST calendar days; a
-- timestamptz would land a 09:00 IST commitment on the previous UTC day and silently move it a day
-- earlier in every aggregate. See lib/kia/followups (the same trap, already paid for once).
--
-- ⚠️ ZERO IS A REAL COMMITMENT AND IS NOT THE SAME AS NO ROW. "I will retail nothing today" (a
-- delivery day with no stock) is a decision; "nobody has said" is not. NOT NULL DEFAULT 0 on the
-- counts with the ROW's existence carrying "a commitment was made" keeps the two apart — absence of
-- the row is absence of a commitment.
--
-- ── What happens to kia_sales_targets ─────────────────────────────────────────────────────────
-- It keeps `team_leader` (which team a consultant reports to, per month — an attribute of the
-- person, not of a day). Its four monthly target columns are SUPERSEDED by this table and are no
-- longer written. They are deliberately NOT dropped here: lib/brands/sales-stock.ts reads
-- bookingTarget/deliveryTarget for the Group Cockpit, and that reader is switched to SUM(this table)
-- in the same change. Dropping columns and rewiring a consumer in one migration leaves no way to
-- roll back half of it.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

CREATE TABLE IF NOT EXISTS public.kia_sales_daily_commitments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_code     text NOT NULL,
  consultant_name text NOT NULL,
  commitment_date date NOT NULL,

  enquiries       integer NOT NULL DEFAULT 0,
  test_drives     integer NOT NULL DEFAULT 0,
  bookings        integer NOT NULL DEFAULT 0,
  retails         integer NOT NULL DEFAULT 0,

  -- Why this day's number is what it is: "half day", "two deliveries held for Navratri".
  note            text,

  created_by      uuid REFERENCES public.users(id),
  updated_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- A commitment is a count of things that will happen. Negative is not a smaller commitment.
  CONSTRAINT kia_sales_daily_commitments_non_negative CHECK (
    enquiries >= 0 AND test_drives >= 0 AND bookings >= 0 AND retails >= 0
  )
);

-- One commitment per consultant per day. This is what the upsert conflicts on.
CREATE UNIQUE INDEX IF NOT EXISTS kia_sales_daily_commitments_unique_idx
  ON public.kia_sales_daily_commitments (dealer_code, consultant_name, commitment_date);

-- Every read is "one outlet, one date range".
CREATE INDEX IF NOT EXISTS kia_sales_daily_commitments_period_idx
  ON public.kia_sales_daily_commitments (dealer_code, commitment_date);

-- ⚠️ Lockdown, per the house rule. The public anon key holds write access to 174 tables in this
-- database; this one is not going to be the 175th.
ALTER TABLE public.kia_sales_daily_commitments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_sales_daily_commitments FROM anon;
REVOKE ALL ON public.kia_sales_daily_commitments FROM PUBLIC;
GRANT ALL ON public.kia_sales_daily_commitments TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'kia_sales_daily_commitments' ORDER BY ordinal_position;
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'kia_sales_daily_commitments' AND grantee = 'anon';   -- must return 0 rows
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'kia_sales_daily_commitments';  -- must be true
