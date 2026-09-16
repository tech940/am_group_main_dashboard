-- 0069 rollback — Revert weekly commitment scopes to day and month only
BEGIN;

DELETE FROM public.kia_sales_commitments WHERE scope IN ('week_1', 'week_2', 'week_3', 'week_4', 'week_5');

ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_scope_check;

ALTER TABLE public.kia_sales_commitments
  ADD CONSTRAINT kia_sales_commitments_scope_check
  CHECK (scope IN ('day', 'month'));

COMMIT;
