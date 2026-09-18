-- Rollback of kia-discounts/0001_discount_without_booking.sql.
-- ⚠️ Fails while any booking-less discount exists (booking_id NULL). Decide what happens to those rows first.
DROP INDEX IF EXISTS public.kia_booking_discounts_dms_customer_idx;
ALTER TABLE public.kia_booking_discounts DROP CONSTRAINT IF EXISTS kia_booking_discounts_subject_chk;
ALTER TABLE public.kia_booking_discounts ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE public.kia_booking_discounts DROP COLUMN IF EXISTS dms_booking_no;
ALTER TABLE public.kia_booking_discounts DROP COLUMN IF EXISTS dms_customer_id;
