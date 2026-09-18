-- Rollback of kia-recon/0002_add_booking_month.sql
DROP INDEX IF EXISTS public.kia_dms_recon_items_booking_month_idx;
ALTER TABLE public.kia_dms_recon_items DROP COLUMN IF EXISTS booking_month;
ALTER TABLE public.kia_dms_recon_items DROP COLUMN IF EXISTS booking_date;
