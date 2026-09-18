-- KIA bookings: a booking may not become 'delivered' without the chassis it was delivered with.
--
-- Why (2026-09-18): 4 of September's 10 KIA deliveries showed "NO VIN ON BOOKING" on the Stock
-- board. All four were closed from the follow-up screen as Converted, a path that delivered with no
-- allotment, payment or VIN check. The app now routes every delivery through one rule
-- (resolveKiaDeliveryVehicle in lib/kia/bookings.ts); this trigger is the backstop for any path that
-- does not — a script, an import, a future route. That has happened twice already on this table.
--
-- Two things are refused:
--   1. entering 'delivered' (INSERT, or UPDATE from another status) with an empty allocated_vin
--   2. clearing allocated_vin on a booking that is already delivered and has one
--
-- Rows ALREADY delivered without a VIN (13 at the time of writing, July–September) are untouched and
-- stay editable: the check fires only on the transition, never on an unrelated edit.
--
-- Apply by hand on the SESSION pooler (5432): npx tsx scripts/apply-kia-delivery-vin-guard.ts

CREATE OR REPLACE FUNCTION public.kia_bookings_require_vin_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND NULLIF(BTRIM(COALESCE(NEW.allocated_vin, '')), '') IS NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'delivered'
       OR NULLIF(BTRIM(COALESCE(OLD.allocated_vin, '')), '') IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'KIA booking % cannot be delivered without an allotted vehicle (VIN).',
      COALESCE(NEW.booking_number, NEW.id::text)
      USING ERRCODE = 'check_violation',
            HINT = 'Allot the vehicle and confirm payment first; delivery stamps the chassis on allocated_vin.';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.kia_bookings_require_vin_on_delivery() FROM PUBLIC;

DROP TRIGGER IF EXISTS kia_bookings_require_vin_on_delivery ON public.kia_bookings;
CREATE TRIGGER kia_bookings_require_vin_on_delivery
  BEFORE INSERT OR UPDATE OF status, allocated_vin ON public.kia_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.kia_bookings_require_vin_on_delivery();
