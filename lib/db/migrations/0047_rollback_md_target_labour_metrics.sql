-- Rollback 0047. Restores the non-negative constraint to its 0043 column list FIRST, so the
-- constraint never references a column that is about to disappear.
--
-- ⚠️ Dropping these columns DESTROYS every labour target the MD has set. There is no backup.

ALTER TABLE md_branch_targets DROP CONSTRAINT IF EXISTS md_branch_targets_nonneg_check;

ALTER TABLE md_branch_targets ADD CONSTRAINT md_branch_targets_nonneg_check CHECK (
  COALESCE(sales_units, 0) >= 0 AND COALESCE(sales_revenue, 0) >= 0
  AND COALESCE(service_ro_count, 0) >= 0 AND COALESCE(service_revenue, 0) >= 0
);

ALTER TABLE md_branch_targets
  DROP COLUMN IF EXISTS service_mech_labour,
  DROP COLUMN IF EXISTS service_bodyshop_labour,
  DROP COLUMN IF EXISTS service_labour_total;

ANALYZE md_branch_targets;
