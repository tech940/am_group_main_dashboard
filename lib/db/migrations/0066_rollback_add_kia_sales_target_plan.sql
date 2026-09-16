-- 0066 ROLLBACK — Sales Target Plan columns on kia_sales_targets
--
-- ⚠️ DESTROYS DATA. Dropping these columns discards every enquiry target, test-drive target and team
-- assignment anyone has typed. Those are DECIDED numbers — nothing re-derives them, no feed contains
-- them, and the workbook they replaced will by then be out of date. Export first:
--
--   \copy (SELECT dealer_code, consultant_name, year, month, enquiry_target, test_drive_target,
--                 booking_target, delivery_target, team_leader, updated_at
--            FROM public.kia_sales_targets
--           WHERE enquiry_target <> 0 OR test_drive_target <> 0 OR team_leader IS NOT NULL
--           ORDER BY year, month, dealer_code, consultant_name)
--     TO 'kia_sales_targets_0066_backup.csv' WITH CSV HEADER;
--
-- booking_target and delivery_target predate 0066 and are NOT dropped.
--
-- The REVOKEs are deliberately NOT undone. Restoring write access for `anon` would hand the public
-- browser key the ability to rewrite every sales target in the company; that was a defect, not a
-- feature of the old shape.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

BEGIN;

DROP INDEX IF EXISTS public.kia_sales_targets_period_idx;

ALTER TABLE public.kia_sales_targets
  DROP COLUMN IF EXISTS enquiry_target,
  DROP COLUMN IF EXISTS test_drive_target,
  DROP COLUMN IF EXISTS team_leader;

COMMIT;

-- Verification (run separately):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'kia_sales_targets'
--    AND column_name IN ('enquiry_target', 'test_drive_target', 'team_leader');  -- must return 0 rows
