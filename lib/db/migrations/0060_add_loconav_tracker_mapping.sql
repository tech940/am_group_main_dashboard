-- 0060 — LocoNav tracker mapping for the Demo Car GatePass fleet (the Trackers screen).
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
-- ⚠️ Requires 0057 (demo_vehicle_trackers).
--
-- ── Why this exists ─────────────────────────────────────────────────────────────────────────
-- 0057 links a tracker to a demo car ONLY when LocoNav's chassisNumber equals our VIN. Measured on the
-- live account (2026-09-11): that field holds a plate or free text for 17 of 18 vehicles ("JK02DQ0770",
-- "SYROS UDHAMPUR"), so the automatic rule linked exactly one car. The owner chose human-confirmed links
-- (demo_vehicle_trackers.matched_by = 'manual') made on a Trackers screen. That screen needs two tables:
--
-- 1. loconav_provider_vehicles — the provider fleet as last listed by the sync. No page may call LocoNav
--    (lib/loconav/client.ts); without a stored copy there is nothing to link TO.
-- 2. demo_vehicle_tracker_events — who linked or unlinked which tracker, and when. A manual link decides
--    whose position is drawn against a car on the fleet board, and it cannot be re-derived from the
--    provider — this table is the only record of why a car shows the location it shows.
--
-- ⚠️ No coordinates and no device phone number in loconav_provider_vehicles. Two of the 18 units on the
-- account ("KIA BAJAJ ...") are not demo cars; where they are is nobody's business on this screen.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. The provider fleet, as last listed. Upserted by lib/loconav/sync.ts on every run.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loconav_provider_vehicles (
  provider                 text NOT NULL DEFAULT 'loconav',
  provider_vehicle_uuid    text NOT NULL,
  -- LocoNav's labels exactly as returned. Evidence for the person choosing a link — never a join key.
  vehicle_number           text,
  display_number           text,
  chassis_number           text,
  device_serial_number     text,
  device_type              text,
  subscription_expires_at  timestamptz,
  -- DEVICE time of the most recent GPS fix. A unit silent for a year still lists on the account (three
  -- of the confirmed links are silent 95-497 days); this is what tells the person linking it.
  last_fix_at              timestamptz,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  -- The last sync that listed this vehicle. Older than the latest successful sync = gone from the account.
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_vehicle_uuid)
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Link / unlink audit. APPEND-ONLY, enforced below rather than merely intended.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_vehicle_tracker_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action                 text NOT NULL CHECK (action IN ('link', 'unlink')),
  vin                    text NOT NULL,
  provider               text NOT NULL DEFAULT 'loconav',
  provider_vehicle_uuid  text NOT NULL,
  -- The label the person saw when they acted, so the row still reads after LocoNav relabels the unit.
  provider_label         text,
  -- How the link being created or removed was established ('manual' for everything the screen writes).
  matched_by             text,
  note                   text,
  -- NULL for a system actor (the initial mapping, confirmed by the owner in chat). The name is required.
  actor_id               uuid,
  actor_name             text NOT NULL,
  actor_role             text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_vehicle_tracker_events_vin_idx
  ON public.demo_vehicle_tracker_events (vin, created_at DESC);

CREATE INDEX IF NOT EXISTS demo_vehicle_tracker_events_provider_uuid_idx
  ON public.demo_vehicle_tracker_events (provider_vehicle_uuid, created_at DESC);

-- An audit row that can be edited is not an audit row. The app never issues UPDATE or DELETE here; this
-- makes that true for any future code path too. search_path pinned per the Supabase security linter.
CREATE OR REPLACE FUNCTION public.demo_vehicle_tracker_events_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'demo_vehicle_tracker_events is append-only (% refused)', TG_OP;
END;
$$;

CREATE OR REPLACE TRIGGER demo_vehicle_tracker_events_append_only
  BEFORE UPDATE OR DELETE ON public.demo_vehicle_tracker_events
  FOR EACH ROW EXECUTE FUNCTION public.demo_vehicle_tracker_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS lockdown, as 0051, 0057 and 0058 — plus `authenticated`.
-- ⚠️ On 2026-09-11 demo_gate_pass_trips was found with RLS switched OFF while `authenticated` held full
-- DML on it, i.e. any signed-in browser session could have read every drive's route. RLS stays the
-- control; revoking the grant as well means the next time RLS is lost, nothing leaks. The app connects as
-- `postgres` (BYPASSRLS, owner) and is unaffected by either.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loconav_provider_vehicles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_vehicle_tracker_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.loconav_provider_vehicles   FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.demo_vehicle_tracker_events FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.loconav_provider_vehicles   TO service_role;
GRANT ALL ON public.demo_vehicle_tracker_events TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('loconav_provider_vehicles', 'demo_vehicle_tracker_events') AND relkind = 'r';  -- both true
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name IN ('loconav_provider_vehicles', 'demo_vehicle_tracker_events')
--    AND grantee IN ('anon', 'authenticated', 'PUBLIC');                                             -- ZERO rows
-- SELECT tgname FROM pg_trigger WHERE tgname = 'demo_vehicle_tracker_events_append_only';            -- one row
