-- Rollback for 0050.
--
-- ⚠️ DESTRUCTIVE. Dropping these columns discards every Sales Manager and MD decision and every
-- Accounts payout confirmation recorded since 0050 ran. The pre-0050 `status` / `action_*` columns
-- are untouched by this file, so the ORIGINAL single-stage outcome survives — but the chain does not.
--
-- Check what would be lost first:
--   SELECT count(*) FROM kia_booking_discounts
--    WHERE sm_status IS NOT NULL OR md_status IS NOT NULL OR payout_status IS NOT NULL;

DROP INDEX IF EXISTS kia_booking_discounts_stage_idx;

ALTER TABLE kia_booking_discounts
  DROP COLUMN IF EXISTS discount_type,
  DROP COLUMN IF EXISTS sm_status,
  DROP COLUMN IF EXISTS sm_by,
  DROP COLUMN IF EXISTS sm_by_name,
  DROP COLUMN IF EXISTS sm_remarks,
  DROP COLUMN IF EXISTS sm_at,
  DROP COLUMN IF EXISTS md_status,
  DROP COLUMN IF EXISTS md_by,
  DROP COLUMN IF EXISTS md_by_name,
  DROP COLUMN IF EXISTS md_remarks,
  DROP COLUMN IF EXISTS md_at,
  DROP COLUMN IF EXISTS md_approved_amount,
  DROP COLUMN IF EXISTS payout_status,
  DROP COLUMN IF EXISTS payout_by,
  DROP COLUMN IF EXISTS payout_by_name,
  DROP COLUMN IF EXISTS payout_remarks,
  DROP COLUMN IF EXISTS payout_at,
  DROP COLUMN IF EXISTS payout_reference,
  DROP COLUMN IF EXISTS vehicle_snapshot;
