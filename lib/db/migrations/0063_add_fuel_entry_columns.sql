-- 0063 — What a fuel entry has to record before mileage can be computed from it.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
--
-- ── Why this exists ─────────────────────────────────────────────────────────────────────────
-- Measured on the live table (2026-09-11): 20 rows, 13 distinct vehicles, 10 with any odometer text,
-- ZERO with a price, and at most one fill per vehicle. Mileage is full-tank-to-full-tank, so it needs a
-- second fill, a trustworthy odometer at both ends, and a full-tank answer — none of which this table can
-- hold today. Cost per km needs the receipt total, which nothing records. The screen this replaces filled
-- both gaps by inventing them: a hardcoded ₹98/litre and demo-drive km divided by all litres.
--
-- ── What is deliberately NOT added ──────────────────────────────────────────────────────────
-- * unit_price — it is total_cost / quantity. Storing it invites the two to disagree; the engine derives it.
-- * a new quantity column — fuel_filled_ltrs ALREADY is the quantity. It is merely misnamed once a vehicle
--   is filled in kg (CNG) or kWh (EV), so it gains a unit beside it rather than a rival column.
--   ⚠️ Two columns holding one fact is the defect that made status + current_stage unmaintainable here.
--
-- ── Columns that DO supersede an existing one ───────────────────────────────────────────────
-- * odometer_km supersedes current_km_reading, which is TEXT and holds free entry. It is not dropped:
--   it stays as the raw thing the person typed, and the backfill script parses it into odometer_km.
-- * energy_type supersedes fuel_type for every decision. fuel_type is free text limited to PETROL/DIESEL
--   in the form, and the demo fleet already contains SYROS EV x2 and CLAVIS EV x1 — cars whose energy the
--   old column cannot express without lying. fuel_type is kept as the label the submitter chose.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. What was filled, and in what unit.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  -- Authoritative energy. Nullable: the 20 historical rows are backfilled from fuel_type, and a row whose
  -- energy nobody can establish must stay NULL rather than be guessed into a mileage calculation.
  ADD COLUMN IF NOT EXISTS energy_type   text,
  -- L = litres (petrol/diesel), kg = CNG, kWh = electricity. Never mixed: km/L, km/kg and km/kWh are
  -- separate figures, and a hybrid simply has two.
  ADD COLUMN IF NOT EXISTS quantity_unit text NOT NULL DEFAULT 'L',
  -- The RECEIPT TOTAL, the owner's decision (2026-09-11): staff type what they paid, not a rate.
  ADD COLUMN IF NOT EXISTS total_cost    numeric(12, 2);

ALTER TABLE public.fuel_approvals
  DROP CONSTRAINT IF EXISTS fuel_approvals_energy_type_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_quantity_unit_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_total_cost_check;

ALTER TABLE public.fuel_approvals
  ADD CONSTRAINT fuel_approvals_energy_type_check
    CHECK (energy_type IS NULL OR energy_type IN ('petrol', 'diesel', 'cng', 'ev', 'hybrid')),
  ADD CONSTRAINT fuel_approvals_quantity_unit_check
    CHECK (quantity_unit IN ('L', 'kg', 'kWh')),
  -- A zero or negative receipt is not a receipt. NULL stays allowed: 20 rows predate price capture.
  ADD CONSTRAINT fuel_approvals_total_cost_check
    CHECK (total_cost IS NULL OR total_cost > 0);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The odometer, typed — and the authorised override that lets an abnormal one be saved.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  ADD COLUMN IF NOT EXISTS odometer_km              numeric(10, 1),
  -- The owner's rule: an abnormal entry is WARNED about, never silently rejected. Someone authorised may
  -- accept it, and that acceptance is itself data — the engine refuses to measure distance across one.
  ADD COLUMN IF NOT EXISTS odometer_override        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS odometer_override_by     uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS odometer_override_at     timestamptz,
  ADD COLUMN IF NOT EXISTS odometer_override_reason text,
  -- Required on every VEHICLE fill from now on (the owner's decision). NULL means "not recorded" and is
  -- never read as either answer — the 20 historical rows are exactly that.
  ADD COLUMN IF NOT EXISTS is_full_tank             boolean;

ALTER TABLE public.fuel_approvals
  DROP CONSTRAINT IF EXISTS fuel_approvals_odometer_km_check,
  DROP CONSTRAINT IF EXISTS fuel_approvals_odometer_override_check;

ALTER TABLE public.fuel_approvals
  ADD CONSTRAINT fuel_approvals_odometer_km_check
    CHECK (odometer_km IS NULL OR odometer_km >= 0),
  -- An override with nobody's name against it is not an authorisation.
  ADD CONSTRAINT fuel_approvals_odometer_override_check
    CHECK (odometer_override = false OR (odometer_override_by IS NOT NULL AND odometer_override_at IS NOT NULL));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. WHICH vehicle. ⚠️ The single most important column here.
--
-- vin_no cannot answer it: measured, 0 of 20 rows hold a VIN. It holds a VIN's last 6 digits ("686082"),
-- a plate ("jk02du7070") or free text ("Stock yad", "GENSET"). veh_reg_no is a description with the plate
-- buried in it. And a plate is not an identity either — JK02C0059TC is a trade plate on FIVE demo cars.
-- vehicle_vin is the resolved 17-character VIN, written only when a person or an unambiguous match
-- established it; it stays NULL rather than guess, and NULL simply means "no mileage for this entry".
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  ADD COLUMN IF NOT EXISTS vehicle_vin text,
  -- For fuel that never goes into a vehicle: GENSET, STOCKYARD. Mutually exclusive with vehicle_vin, and
  -- the reason an asset entry asks for no odometer and no full-tank answer.
  ADD COLUMN IF NOT EXISTS asset_code  text;

ALTER TABLE public.fuel_approvals
  DROP CONSTRAINT IF EXISTS fuel_approvals_consumer_check;

ALTER TABLE public.fuel_approvals
  ADD CONSTRAINT fuel_approvals_consumer_check
    CHECK (vehicle_vin IS NULL OR asset_code IS NULL);

CREATE INDEX IF NOT EXISTS fuel_approvals_vehicle_vin_idx
  ON public.fuel_approvals (vehicle_vin, fuel_filled_date DESC)
  WHERE vehicle_vin IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Who drove it and where it was filled — the driver and station analysis the owner asked for.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  ADD COLUMN IF NOT EXISTS driver_user_id   uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS driver_name      text,
  ADD COLUMN IF NOT EXISTS station_name     text,
  ADD COLUMN IF NOT EXISTS station_location text;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Stale defaults from before the CEO became the final approver.
-- The live table still defaults a new row to the 'ed' stage, a step that no longer exists in the flow.
-- Every app insert supplies these explicitly, so this only corrects what raw SQL would produce.
-- ⚠️ Statuses are free text against a UI list by house rule (0050) — no enum, no ALTER TYPE.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  ALTER COLUMN status        SET DEFAULT 'ceo_pending',
  ALTER COLUMN current_stage SET DEFAULT 'ceo';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. ⚠️ GRANT LOCKDOWN — READ THIS BEFORE APPLYING.
--
-- Measured 2026-09-11: RLS is ON, anon holds nothing, but `authenticated` holds SELECT, INSERT, UPDATE,
-- DELETE and TRUNCATE on fuel_approvals. RLS is the control that stops it being used; this removes the
-- grant as well, so the next time RLS is lost on this table, nothing leaks and nothing can be deleted.
-- The app connects as `postgres` (owner, BYPASSRLS) and is completely unaffected.
--
-- This is the same change approved for the tracking tables in 0062. If you would rather review it
-- separately, delete this section before applying — the rest of 0063 stands on its own.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.fuel_approvals FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.fuel_approvals TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'fuel_approvals'
--    AND column_name IN ('energy_type','quantity_unit','total_cost','odometer_km','is_full_tank',
--                        'vehicle_vin','asset_code','driver_user_id','station_name');            -- 9 rows
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'fuel_approvals' AND grantee IN ('anon','authenticated','PUBLIC');         -- ZERO rows
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.fuel_approvals'::regclass
--   AND conname LIKE 'fuel_approvals_%_check';                                                   -- 6 rows
