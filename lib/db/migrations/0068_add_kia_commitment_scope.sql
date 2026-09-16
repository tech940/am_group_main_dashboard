-- 0068 — A commitment can be made for a DAY or for the MONTH
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- Owner decision, 2026-09-16: the Commitments screen must ask which one is being recorded and handle
-- both. Both genuinely exist in the workbook this replaces, and they are NOT the same statement:
--
--   · the MONTH commitment is what a consultant signs up to for September — the workbook's
--     "Target 26t / Month" column, agreed once at the start;
--   · the DAY commitment is how they intend to get there — the "Daywise Tracking Format" sheet,
--     decided each morning.
--
-- Keeping only one of them loses something real. Keeping both in two different tables would make
-- "what is committed for September" ambiguous, so they live in ONE table separated by `scope`, and
-- the reader states a single precedence rule for which one scores the month (see
-- lib/kia/sales-target-plan.ts).
--
-- ── The rename ────────────────────────────────────────────────────────────────────────────────
-- The table was created yesterday as `kia_sales_daily_commitments` and holds ZERO rows, so renaming
-- it now costs nothing and stops the name lying about its contents the moment monthly rows land in
-- it. Done here rather than "later" because later never comes and a table called `daily` full of
-- monthly rows is exactly the kind of thing that misleads whoever reads it next.
--
-- ── The uniqueness rule changes ───────────────────────────────────────────────────────────────
-- ⚠️ THE OLD UNIQUE INDEX WOULD COLLIDE. It is (dealer, consultant, date), and a monthly commitment
-- is stored against the 1st of its month — so a monthly row and a 1st-of-the-month daily row for the
-- same person would fight over one slot and the upsert would overwrite one with the other. `scope`
-- joins the key.
--
-- ⚠️ AND A MONTHLY ROW MUST SIT ON THE 1st. Nothing else is meaningful, and without the constraint a
-- monthly commitment written against the 14th would simply vanish from every monthly read.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

ALTER TABLE IF EXISTS public.kia_sales_daily_commitments
  RENAME TO kia_sales_commitments;

ALTER TABLE public.kia_sales_commitments
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'day';

-- Free text against a UI-supplied list, never a pgEnum: a new value must not need a migration, and
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction. House rule, stated in 0050.
ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_scope_check;
ALTER TABLE public.kia_sales_commitments
  ADD CONSTRAINT kia_sales_commitments_scope_check CHECK (scope IN ('day', 'month'));

-- ⚠️ A monthly commitment is anchored to the 1st of its month. Anywhere else and it is invisible.
ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_month_anchor_check;
ALTER TABLE public.kia_sales_commitments
  ADD CONSTRAINT kia_sales_commitments_month_anchor_check
  CHECK (scope <> 'month' OR EXTRACT(DAY FROM commitment_date) = 1);

ALTER INDEX IF EXISTS kia_sales_daily_commitments_unique_idx
  RENAME TO kia_sales_commitments_unique_idx_old;
ALTER INDEX IF EXISTS kia_sales_daily_commitments_period_idx
  RENAME TO kia_sales_commitments_period_idx;

-- The upsert conflicts on this; scope is part of the identity now.
CREATE UNIQUE INDEX IF NOT EXISTS kia_sales_commitments_unique_idx
  ON public.kia_sales_commitments (dealer_code, consultant_name, commitment_date, scope);

DROP INDEX IF EXISTS kia_sales_commitments_unique_idx_old;

ALTER TABLE public.kia_sales_commitments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_sales_commitments FROM anon;
REVOKE ALL ON public.kia_sales_commitments FROM PUBLIC;
GRANT ALL ON public.kia_sales_commitments TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT to_regclass('public.kia_sales_daily_commitments');  -- must be NULL
-- SELECT to_regclass('public.kia_sales_commitments');        -- must not be NULL
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.kia_sales_commitments'::regclass;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'kia_sales_commitments';
