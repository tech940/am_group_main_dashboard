-- 0063 ROLLBACK — remove the fuel entry columns.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432.
--
-- ⚠️⚠️ DESTROYS DATA ⚠️⚠️
-- Dropping these columns destroys every receipt total, typed odometer, full-tank answer, resolved VIN,
-- driver and station recorded since 0063 was applied. NONE of it can be recovered from the columns that
-- remain: current_km_reading is free text, vin_no is not a VIN, and no price was ever stored elsewhere.
-- Every mileage and cost figure in Fuel Management is computed from exactly these columns and will be gone.
--
-- EXPORT FIRST, and check the file is non-empty before continuing:
--
--   \copy (SELECT id, request_number, fuel_filled_date, veh_reg_no, vin_no, vehicle_vin, asset_code,
--                 energy_type, fuel_filled_ltrs, quantity_unit, total_cost, odometer_km, is_full_tank,
--                 odometer_override, odometer_override_by, odometer_override_at, odometer_override_reason,
--                 driver_user_id, driver_name, station_name, station_location
--            FROM public.fuel_approvals ORDER BY created_at)
--     TO 'fuel_approvals_0063_backup.csv' WITH CSV HEADER;

BEGIN;

DROP INDEX IF EXISTS public.fuel_approvals_vehicle_vin_idx;

ALTER TABLE public.fuel_approvals
  DROP CONSTRAINT IF EXISTS fuel_approvals_energy_type_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_quantity_unit_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_total_cost_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_odometer_km_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_odometer_override_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_consumer_check;

ALTER TABLE public.fuel_approvals
  DROP COLUMN IF EXISTS energy_type,
  DROP COLUMN IF EXISTS quantity_unit,
  DROP COLUMN IF EXISTS total_cost,
  DROP COLUMN IF EXISTS odometer_km,
  DROP COLUMN IF EXISTS odometer_override,
  DROP COLUMN IF EXISTS odometer_override_by,
  DROP COLUMN IF EXISTS odometer_override_at,
  DROP COLUMN IF EXISTS odometer_override_reason,
  DROP COLUMN IF EXISTS is_full_tank,
  DROP COLUMN IF EXISTS vehicle_vin,
  DROP COLUMN IF EXISTS asset_code,
  DROP COLUMN IF EXISTS driver_user_id,
  DROP COLUMN IF EXISTS driver_name,
  DROP COLUMN IF EXISTS station_name,
  DROP COLUMN IF EXISTS station_location;

-- The pre-0063 defaults, for an exact restore of the previous state.
ALTER TABLE public.fuel_approvals
  ALTER COLUMN status        SET DEFAULT 'ed_pending',
  ALTER COLUMN current_stage SET DEFAULT 'ed';

-- ⚠️ The grant lockdown in section 6 is deliberately NOT undone. Re-granting `authenticated` full DML on
-- a table of fuel records would be a new security decision, not a rollback of a schema change. If it is
-- genuinely wanted, do it explicitly and knowingly:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_approvals TO authenticated;

COMMIT;

-- Verification (run separately):
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name = 'fuel_approvals'
--    AND column_name IN ('energy_type','total_cost','odometer_km','vehicle_vin');   -- 0
