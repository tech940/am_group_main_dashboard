-- 0075 Rollback
ALTER TABLE public.kia_walk_in_leads
  DROP COLUMN IF EXISTS follow_up_date,
  DROP COLUMN IF EXISTS holding_reason,
  DROP COLUMN IF EXISTS expected_booking_timeline;
