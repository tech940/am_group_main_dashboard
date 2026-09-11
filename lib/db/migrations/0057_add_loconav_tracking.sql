-- 0057 — LocoNav telematics for the Demo Car GatePass fleet.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
--
-- ── Why three tables and not columns on demo_vehicle_details ─────────────────────────────────
-- demo_vehicle_details is raw SQL (scripts/create-demo-vehicle-details.sql), is NOT in
-- lib/db/schema.ts, and is written by app/api/brands/kia/demo-cars-list/route.ts. Bolting provider
-- state onto it would put two writers on one row and leave the mapping invisible to Drizzle. These
-- are app-owned, Drizzle-modelled, and keyed the way the gate pass module is keyed: on VIN.
--
-- ⚠️ VIN IS THE KEY. NEVER THE REGISTRATION NUMBER. Measured on the live feed: 29 demo VINs, 25
-- distinct plates — `JK02C0059TC` is a trade-certificate plate worn by FIVE different cars. LocoNav
-- identifies a vehicle by plate, device serial or its own uuid, so the mapping is built from the
-- `chassisNumber` its List Vehicles endpoint returns (that is the VIN) and `matched_by` records how
-- each row was established. A plate-derived match is not allowed to enter silently.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. VIN -> provider vehicle identity.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_vehicle_trackers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin                      text NOT NULL,
  provider                 text NOT NULL DEFAULT 'loconav',
  provider_vehicle_uuid    text NOT NULL,
  -- Diagnostics only. Stored so a mismatch between our plate and theirs is VISIBLE, never so it can
  -- be used as a join key.
  provider_vehicle_number  text,
  device_serial_number     text,
  device_type              text,
  subscription_expires_at  timestamptz,
  -- 'chassis'  — matched on the VIN the provider returned. The only automatic match allowed.
  -- 'manual'   — a human pinned it. Recorded so it survives a resync.
  matched_by               text NOT NULL DEFAULT 'chassis'
                             CHECK (matched_by IN ('chassis', 'manual')),
  last_seen_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One tracker per car...
CREATE UNIQUE INDEX IF NOT EXISTS demo_vehicle_trackers_vin_idx
  ON public.demo_vehicle_trackers (vin);

-- ...and one car per tracker. Without this a provider row could be claimed by two VINs and both
-- cars would report the same position, which is exactly the failure the plate collision causes.
CREATE UNIQUE INDEX IF NOT EXISTS demo_vehicle_trackers_provider_uuid_idx
  ON public.demo_vehicle_trackers (provider, provider_vehicle_uuid);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Last known position. ONE ROW PER VEHICLE, upserted — not a trail.
--    The provider already stores history and serves it through /timeline on demand, so duplicating
--    it here would be an unbounded table we would have to prune, for data we can always re-ask for.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_vehicle_positions (
  vin            text PRIMARY KEY,
  provider       text NOT NULL DEFAULT 'loconav',
  latitude       numeric(10, 7),
  longitude      numeric(10, 7),
  speed_kph      numeric(6, 2),
  ignition       text,
  address        text,
  -- When the DEVICE recorded it. Distinct from fetched_at: a parked car with a sleeping unit can
  -- return a position that is hours old, and showing that as "live" is the whole trap.
  position_at    timestamptz,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  raw            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_vehicle_positions_position_at_idx
  ON public.demo_vehicle_positions (position_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Sync state — a singleton, so nobody mistakes stale data for live data.
--    Modelled on the Callyzer sync-state row (lib/callyzer/sync.ts): written on FAILURE as well as
--    success, and surfaced in the UI.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loconav_sync_state (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_run_at        timestamptz,
  last_success_at    timestamptz,
  last_run_status    text,
  last_run_detail    text,
  vehicles_mapped    integer NOT NULL DEFAULT 0,
  positions_updated  integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.loconav_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS lockdown, copied from 0051. The public anon key holds write access to 174 tables in this
-- database; new tables do not join that list.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.demo_vehicle_trackers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_vehicle_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loconav_sync_state     ENABLE ROW LEVEL SECURITY;

-- `authenticated` added 2026-09-11 (see 0062): a rollback + re-apply of this file must not bring it back.
REVOKE ALL ON public.demo_vehicle_trackers  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.demo_vehicle_positions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.loconav_sync_state     FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.demo_vehicle_trackers  TO service_role;
GRANT ALL ON public.demo_vehicle_positions TO service_role;
GRANT ALL ON public.loconav_sync_state     TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT table_name, rowsecurity FROM pg_tables t
--   JOIN information_schema.tables i USING (table_name)
--  WHERE table_name IN ('demo_vehicle_trackers','demo_vehicle_positions','loconav_sync_state');
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name IN ('demo_vehicle_trackers','demo_vehicle_positions','loconav_sync_state')
--    AND grantee IN ('anon','PUBLIC');   -- must return ZERO rows
