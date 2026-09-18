-- Rollback of kia-delivery/0001_require_vin_on_delivery.sql
DROP TRIGGER IF EXISTS kia_bookings_require_vin_on_delivery ON public.kia_bookings;
DROP FUNCTION IF EXISTS public.kia_bookings_require_vin_on_delivery();
