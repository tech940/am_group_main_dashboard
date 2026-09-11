-- 0058 — Trip reconciliation for the Demo Car GatePass fleet (LocoNav phase 2).
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
-- ⚠️ Requires 0057 (demo_vehicle_trackers / demo_vehicle_positions / loconav_sync_state).
--
-- ── What this answers ────────────────────────────────────────────────────────────────────────
-- Until now every measure of a demo drive came from FOUR facts: two timestamps a phone stamped at
-- the barrier, and two odometer numbers a GUARD TYPED. Nothing verified them, and nothing at all was
-- known about the drive between the two gates.
--
-- One row per returned pass holds the provider's own account of that same window: distance actually
-- travelled, how long the car moved versus sat, top speed, the route, and any harsh-driving alert.
--
-- ── Why a table and not columns on demo_gate_passes ──────────────────────────────────────────
-- The pass is the operational record and is written by the gate flow. This is derived, arrives late,
-- can fail, and is retried — a different lifecycle and a different writer. Bolting it on would put a
-- background job into the same row a guard is updating at a barrier.

BEGIN;

CREATE TABLE IF NOT EXISTS public.demo_gate_pass_trips (
  -- One row per pass. CASCADE because this is derived data with no independent meaning: unlike
  -- demo_gate_pass_events (which uses SET NULL so history outlives the record), a reconciliation
  -- for a pass that no longer exists is noise.
  gate_pass_id            uuid PRIMARY KEY
                            REFERENCES public.demo_gate_passes(id) ON DELETE CASCADE,
  -- Flat copies, so the row still reads on its own in a CSV export.
  pass_no                 text NOT NULL,
  vin                     text NOT NULL,

  provider                text NOT NULL DEFAULT 'loconav',
  provider_vehicle_uuid   text,

  -- The window actually queried. Stored because gate_out_at / gate_in_at can be corrected later, and
  -- a distance figure means nothing without the window it was measured over.
  window_start            timestamptz,
  window_end              timestamptz,

  -- The two independent accounts of the same journey.
  provider_distance_km    numeric(10, 2),
  odometer_distance_km    numeric(10, 2),
  -- provider - odometer. Signed on purpose: a NEGATIVE delta (odometer says further than GPS) reads
  -- very differently from a positive one.
  delta_km                numeric(10, 2),

  max_speed_kph           numeric(6, 2),
  moving_seconds          integer,
  stopped_seconds         integer,
  stop_count              integer,

  -- Route segments as the provider returned them, including the encoded polylines. jsonb, not a
  -- separate table: it is read whole, per pass, and never queried across passes.
  timeline                jsonb NOT NULL DEFAULT '[]'::jsonb,
  alert_count             integer NOT NULL DEFAULT 0,
  alerts                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- 'reconciled' — the provider answered and the numbers are stored.
  -- 'untracked'  — the car has no provider mapping. TERMINAL: never retried, or every sweep would
  --                re-ask the same unanswerable question for every untracked car for ever.
  -- 'unavailable'— mapped, but the provider returned no distance for that window (history pruned,
  --                or the unit was offline for the whole trip). Terminal after `attempts`.
  -- 'failed'     — the call errored. Retried until attempts runs out.
  status                  text NOT NULL DEFAULT 'failed'
                            CHECK (status IN ('reconciled', 'untracked', 'unavailable', 'failed')),
  detail                  text,
  attempts                integer NOT NULL DEFAULT 0,
  reconciled_at           timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- The sweep's own query: unreconciled first, oldest first.
CREATE INDEX IF NOT EXISTS demo_gate_pass_trips_status_idx
  ON public.demo_gate_pass_trips (status, updated_at);

CREATE INDEX IF NOT EXISTS demo_gate_pass_trips_vin_idx
  ON public.demo_gate_pass_trips (vin);

-- RLS lockdown, as 0051 and 0057. The public anon key holds write access to 174 tables in this
-- database; new tables do not join that list.
ALTER TABLE public.demo_gate_pass_trips ENABLE ROW LEVEL SECURITY;
-- `authenticated` added 2026-09-11 (see 0062): a rollback + re-apply of this file must not bring it back.
REVOKE ALL ON public.demo_gate_pass_trips FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.demo_gate_pass_trips TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT status, COUNT(*) FROM public.demo_gate_pass_trips GROUP BY 1;
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'demo_gate_pass_trips' AND grantee IN ('anon','PUBLIC');  -- must be ZERO rows
