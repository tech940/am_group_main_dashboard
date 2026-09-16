-- Rollback for 0071_add_fuel_accountability.sql
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432, never the pgbouncer pooler (6543).
--
-- ⚠️ DESTROYS DATA. It drops the approved and actual quantities people recorded, every request's link to its
-- gate pass, the using department, and every exception review. Export first:
--
--   \copy (SELECT id, request_number, approved_quantity, actual_quantity, gate_pass_id, department
--          FROM public.fuel_approvals
--          WHERE approved_quantity IS NOT NULL OR actual_quantity IS NOT NULL
--             OR gate_pass_id IS NOT NULL OR department IS NOT NULL)
--     TO 'fuel_approvals_0071_columns.csv' WITH CSV HEADER
--   \copy (SELECT * FROM public.fuel_exception_reviews) TO 'fuel_exception_reviews.csv' WITH CSV HEADER

BEGIN;

DROP TABLE IF EXISTS public.fuel_exception_reviews;
DROP FUNCTION IF EXISTS public.fuel_exception_reviews_append_only();

DROP INDEX IF EXISTS public.fuel_approvals_gate_pass_id_key;
DROP INDEX IF EXISTS public.fuel_approvals_fill_date_idx;

ALTER TABLE public.fuel_approvals
  DROP CONSTRAINT IF EXISTS fuel_approvals_gate_pass_id_fkey,
  DROP CONSTRAINT IF EXISTS fuel_approvals_actual_quantity_positive,
  DROP CONSTRAINT IF EXISTS fuel_approvals_approved_quantity_positive;

ALTER TABLE public.fuel_approvals
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS gate_pass_id,
  DROP COLUMN IF EXISTS actual_quantity,
  DROP COLUMN IF EXISTS approved_quantity;

COMMIT;

-- Verification (run separately):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'fuel_approvals'
--    AND column_name IN ('approved_quantity','actual_quantity','gate_pass_id','department');   -- ZERO rows
-- SELECT to_regclass('public.fuel_exception_reviews');                                          -- NULL
