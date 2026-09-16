-- 0068 ROLLBACK — commitment scope, and the table rename
--
-- ⚠️ DESTROYS DATA: every MONTHLY commitment. Daily rows survive the rollback (they are scope='day'
-- and the column simply goes away), but a monthly commitment has nowhere to live once `scope` is
-- gone, and dropping the column would silently turn each one into a daily commitment dated the 1st —
-- a number nobody made, attached to a day nobody chose. They are deleted explicitly instead, so the
-- loss is visible rather than disguised. Export first:
--
--   \copy (SELECT dealer_code, consultant_name, commitment_date, enquiries, test_drives, bookings,
--                 retails, note, updated_at
--            FROM public.kia_sales_commitments WHERE scope = 'month'
--           ORDER BY dealer_code, commitment_date, consultant_name)
--     TO 'kia_monthly_commitments_0068_backup.csv' WITH CSV HEADER;
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

DELETE FROM public.kia_sales_commitments WHERE scope = 'month';

DROP INDEX IF EXISTS kia_sales_commitments_unique_idx;

ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_month_anchor_check;
ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_scope_check;
ALTER TABLE public.kia_sales_commitments DROP COLUMN IF EXISTS scope;

ALTER TABLE IF EXISTS public.kia_sales_commitments
  RENAME TO kia_sales_daily_commitments;

CREATE UNIQUE INDEX IF NOT EXISTS kia_sales_daily_commitments_unique_idx
  ON public.kia_sales_daily_commitments (dealer_code, consultant_name, commitment_date);
ALTER INDEX IF EXISTS kia_sales_commitments_period_idx
  RENAME TO kia_sales_daily_commitments_period_idx;

COMMIT;

-- Verification (run separately):
-- SELECT to_regclass('public.kia_sales_commitments');  -- must be NULL
