-- MD Targets: labour-value targets for the workshop, split Mech / Bodyshop / Total.
--
-- ── Why labour VALUE targets, when 0043 deliberately refused revenue targets ──────────────────
-- lib/targets/constants.ts records the original decision: revenue targets were dropped because
-- per-unit price is not forecastable — an RO's value depends on what the vehicle turns out to need,
-- and a month's sales revenue moves with model mix and discounting.
--
-- Labour is the exception, and the difference is real rather than a change of mind. Labour value is
-- hours sold at a published rate: the workshop controls bay capacity, technician count and the menu
-- price, so a labour number is something a service manager can actually commit to. Parts value is
-- not (it is whatever the vehicle needed), which is why these three columns are labour_amt ONLY and
-- do NOT include part_amt. service_revenue (labour + parts) stays context-only and unscored.
--
-- ── NULL is not zero ──────────────────────────────────────────────────────────────────────────
-- Same rule as 0043: NULL means "the MD set nothing" and is what keeps the LY+10% auto fallback
-- alive for that month; 0 is a deliberate target of zero. So no DEFAULT, and the columns stay
-- nullable. A DEFAULT 0 would light up every branch as 100% achieved against a target nobody set.
--
-- ── RO count already exists ───────────────────────────────────────────────────────────────────
-- The fourth workshop target the MD asked for ("RO") is service_ro_count, added in 0043. This
-- migration adds only the three labour columns.
--
-- Migrations here are applied BY HAND on the direct/session port (never the pgbouncer pooler).

ALTER TABLE md_branch_targets
  ADD COLUMN IF NOT EXISTS service_mech_labour     numeric(14,2),
  ADD COLUMN IF NOT EXISTS service_bodyshop_labour numeric(14,2),
  ADD COLUMN IF NOT EXISTS service_labour_total    numeric(14,2);

COMMENT ON COLUMN md_branch_targets.service_mech_labour IS
  'Monthly MECHANICAL labour target in rupees. labour_amt only, EXCLUDES parts. Scored against the '
  'Free Service + Paid Service + Running Repair work_type buckets — the same CASE the brand''s own '
  'Workshop Summary uses, so target and CY sit on one basis. NULL = not set (never 0).';

COMMENT ON COLUMN md_branch_targets.service_bodyshop_labour IS
  'Monthly BODYSHOP labour target in rupees. labour_amt only, EXCLUDES parts. Scored against the '
  'Accidental Repair work_type bucket. NULL = not set (never 0).';

COMMENT ON COLUMN md_branch_targets.service_labour_total IS
  'Monthly TOTAL labour target in rupees. labour_amt only, EXCLUDES parts — so this is NOT a '
  'subdivision of service_revenue, which is labour + parts. Set independently of the two splits: '
  'the MD may commit to a total more ambitious than mech + bodyshop. NULL = not set (never 0).';

-- ── Extend the non-negative guard ─────────────────────────────────────────────────────────────
-- md_branch_targets_nonneg_check (0043) names its four columns explicitly, so it does NOT cover
-- these. Without this, a negative labour target would pass the database and rely entirely on the
-- route-level clamp. Dropped and recreated rather than added alongside, so there is exactly one
-- constraint to read and to keep in step with the column list.
ALTER TABLE md_branch_targets DROP CONSTRAINT IF EXISTS md_branch_targets_nonneg_check;

ALTER TABLE md_branch_targets ADD CONSTRAINT md_branch_targets_nonneg_check CHECK (
  COALESCE(sales_units, 0) >= 0
  AND COALESCE(sales_revenue, 0) >= 0
  AND COALESCE(service_ro_count, 0) >= 0
  AND COALESCE(service_revenue, 0) >= 0
  AND COALESCE(service_mech_labour, 0) >= 0
  AND COALESCE(service_bodyshop_labour, 0) >= 0
  AND COALESCE(service_labour_total, 0) >= 0
);

ANALYZE md_branch_targets;
