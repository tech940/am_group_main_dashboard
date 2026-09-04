-- 0051 — Demo Car GatePass Management.
--
-- ── What this creates ─────────────────────────────────────────────────────────────────────────
-- Three NEW tables. No existing table, column or row is touched.
--
--   demo_gate_passes        one demo car leaving and returning: request -> approve -> out -> in
--   demo_gate_pass_events   append-only audit, one row per transition, full snapshot as jsonb
--   demo_gate_pass_drivers  this module's own driving-licence store, keyed on users.id
--
-- ── Why a fresh set of tables ─────────────────────────────────────────────────────────────────
-- A DIFFERENT application already writes kia_trips / kia_vehicle / kia_employees against this same
-- database (91 live KIA trips as of 2026-09-04, plus per-brand twins). Those tables stay untouched
-- by explicit decision. Until that app is retired, two systems record the same physical gate event.
--
-- ── Why the vehicle is copied, not joined ─────────────────────────────────────────────────────
-- The demo fleet lives in demo_car_list, read through lib/analytics/db.ts — a pluggable provider
-- that is Postgres today but is designed to swap to BigQuery (ANALYTICS_READ_SOURCE). A join across
-- providers is not expressible. It is also the right audit behaviour: a gate record must show what
-- the vehicle was WHEN IT LEFT, not what today's feed says. Hence vin / registration_number /
-- model / variant / color / key_number are snapshot columns here, with no foreign key.
--
-- Source of truth for the fleet, measured 2026-09-04:
--   demo_car_list WHERE test_drive_vin='YES'  -> 29 VINs (JK402 Jammu 25, JK501 Udhampur 4)
--   all 29 resolve to a registration_number in demo_vehicle_details (keyed on vehicle_key = VIN)
--
-- ── Why status is text and there is no current_stage ──────────────────────────────────────────
-- Free text against a UI-supplied list rather than an enum: a new status must not need a migration,
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, and a missing one has taken this app
-- down before. The vocabulary is owned by lib/gate-pass/status.ts.
--
-- With a SINGLE approver, status alone is authoritative, so there is deliberately no current_stage
-- column duplicating it. purchase_orders carries stage + status + per-stage columns and the three
-- drifted apart.
--
-- Run against the direct/session port (5432), NOT the pgbouncer pooler (6543).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. the gate pass ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_gate_passes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_no                     text NOT NULL UNIQUE,
  brand                       text NOT NULL DEFAULT 'kia',
  dealer_code                 text NOT NULL,

  -- Vehicle snapshot. vin is the identity; registration_number is what the guard reads off the car.
  vin                         text NOT NULL,
  registration_number         text,
  model                       text,
  variant                     text,
  color                       text,
  key_number                  text,

  requested_by                uuid REFERENCES users(id),
  requested_by_name           text NOT NULL,
  requested_by_email          text NOT NULL,
  department                  text,

  -- 'staff'    -> a dashboard user; licence pre-filled from demo_gate_pass_drivers.
  -- 'customer' -> a stranger; the licence is captured as a PHOTO at the gate and the number is
  --               NOT stored. driver_licence_no stays NULL for these on purpose.
  driver_kind                 text NOT NULL DEFAULT 'staff',
  driver_user_id              uuid REFERENCES users(id),
  driver_name                 text NOT NULL,
  driver_phone                text,
  driver_licence_no           text,
  driver_licence_expiry       date,

  purpose                     text NOT NULL,
  purpose_note                text,
  expected_return_at          timestamptz NOT NULL,
  remarks                     text,

  -- 'pending_approval' | 'approved' | 'rejected' | 'out' | 'returned' | 'cancelled' | 'expired'
  status                      text NOT NULL DEFAULT 'pending_approval',

  approved_by                 uuid REFERENCES users(id),
  approved_by_name            text,
  approved_by_role            text,
  approved_at                 timestamptz,
  approval_remarks            text,

  gate_out_at                 timestamptz,
  gate_out_odo                numeric(12, 0),
  gate_out_guard_name         text,
  gate_out_signature_path     text,
  gate_out_photo_paths        jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_licence_path       text,
  customer_licence_checked_by text,

  gate_in_at                  timestamptz,
  gate_in_odo                 numeric(12, 0),
  gate_in_guard_name          text,
  gate_in_signature_path      text,
  gate_in_photo_paths         jsonb NOT NULL DEFAULT '{}'::jsonb,
  parked_location             text,
  key_handover_to             text,
  gate_in_remarks             text,

  cancelled_by                uuid REFERENCES users(id),
  cancelled_by_name           text,
  cancelled_at                timestamptz,
  cancel_reason               text,

  -- Idempotency for the overdue sweep (the reminder_sent_at pattern from lib/delegation/emails.ts).
  -- Without it the cron re-mails the same pass on every run.
  overdue_notified_at         timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_gate_passes_status_idx
  ON public.demo_gate_passes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_gate_passes_dealer_idx
  ON public.demo_gate_passes (dealer_code, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_gate_passes_vin_idx
  ON public.demo_gate_passes (vin, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_gate_passes_requester_idx
  ON public.demo_gate_passes (requested_by, created_at DESC);
-- The overdue sweep scans only live passes; a partial index keeps it off the whole table.
CREATE INDEX IF NOT EXISTS demo_gate_passes_open_return_idx
  ON public.demo_gate_passes (expected_return_at)
  WHERE status IN ('approved', 'out');

-- ── 2. the audit trail ────────────────────────────────────────────────────────────────────────
-- Append-only. One row per transition, carrying the FULL post-action snapshot as jsonb plus a flat
-- pass_no copy so "history of this pass" is one indexed read.
--
-- gate_pass_id is SET NULL on delete so the history OUTLIVES the record it describes — the same
-- posture as bank_sanction_history (0045). Deliberately NOT a history jsonb array on the pass row:
-- that append is a read-modify-write outside a transaction and silently loses an entry when two
-- actions race, which for a gate log is not acceptable.
CREATE TABLE IF NOT EXISTS public.demo_gate_pass_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_pass_id    uuid REFERENCES public.demo_gate_passes(id) ON DELETE SET NULL,
  pass_no         text NOT NULL,
  action          text NOT NULL, -- 'created' | 'approved' | 'rejected' | 'cancelled'
                                 -- | 'gate_out' | 'gate_in' | 'expired'
  actor_id        uuid REFERENCES users(id),
  actor_name      text NOT NULL,
  actor_role      text,          -- NULL for a guard: they have no account by design
  previous_status text,
  new_status      text,
  remarks         text,
  snapshot        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_gate_pass_events_pass_idx
  ON public.demo_gate_pass_events (gate_pass_id, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_gate_pass_events_pass_no_idx
  ON public.demo_gate_pass_events (pass_no, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_gate_pass_events_actor_idx
  ON public.demo_gate_pass_events (actor_id, created_at DESC);

-- ── 3. the driver licence store ───────────────────────────────────────────────────────────────
-- Nothing in this app's own schema carries a driving licence. kia_employees does, but it belongs to
-- the separate application above and is off-limits. Keyed on users.id so a staff driver types their
-- licence once and it pre-fills forever, and so the request form can refuse an expired licence.
-- Customers are never stored here; their licence is a photo on the pass itself.
CREATE TABLE IF NOT EXISTS public.demo_gate_pass_drivers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  licence_no     text NOT NULL,
  licence_expiry date,
  phone          text,
  updated_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── 4. lock away from the public anon key (same posture as 0038/0043/0045) ────────────────────
-- Not optional. The public anon key holds write access to a large part of this database; these
-- tables carry driving licence numbers, driver phone numbers and gate photo paths.
ALTER TABLE IF EXISTS public.demo_gate_passes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.demo_gate_pass_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.demo_gate_pass_drivers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.demo_gate_passes       FROM anon;
REVOKE ALL ON public.demo_gate_passes       FROM PUBLIC;
REVOKE ALL ON public.demo_gate_pass_events  FROM anon;
REVOKE ALL ON public.demo_gate_pass_events  FROM PUBLIC;
REVOKE ALL ON public.demo_gate_pass_drivers FROM anon;
REVOKE ALL ON public.demo_gate_pass_drivers FROM PUBLIC;

GRANT ALL ON public.demo_gate_passes       TO service_role;
GRANT ALL ON public.demo_gate_pass_events  TO service_role;
GRANT ALL ON public.demo_gate_pass_drivers TO service_role;

ANALYZE public.demo_gate_passes;

-- Verify — expect 1,1,1 and then t,t,t.
-- SELECT
--   (to_regclass('public.demo_gate_passes')       IS NOT NULL)::int AS passes_table,
--   (to_regclass('public.demo_gate_pass_events')  IS NOT NULL)::int AS events_table,
--   (to_regclass('public.demo_gate_pass_drivers') IS NOT NULL)::int AS drivers_table;
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('demo_gate_passes','demo_gate_pass_events','demo_gate_pass_drivers');
