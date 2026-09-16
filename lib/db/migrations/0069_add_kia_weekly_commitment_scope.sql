-- 0069 — Support Weekly commitment scopes (Week 1, Week 2, Week 3, Week 4, Week 5)
BEGIN;

ALTER TABLE public.kia_sales_commitments
  DROP CONSTRAINT IF EXISTS kia_sales_commitments_scope_check;

ALTER TABLE public.kia_sales_commitments
  ADD CONSTRAINT kia_sales_commitments_scope_check
  CHECK (scope IN ('day', 'month', 'week_1', 'week_2', 'week_3', 'week_4', 'week_5'));

COMMIT;
