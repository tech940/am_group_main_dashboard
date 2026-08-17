-- KIA vehicle allotment: optional "extra payment time" request, decided by the MD.
--
-- Additive, non-destructive. Two parts.
--
-- 1. kia_vehicle_allocations.payment_window_hours — the EFFECTIVE payment window for ONE
--    allocation, in hours.
--
--    It exists because the window used to be implied in TWO places that had to be kept in sync by
--    hand: the immediate allot path (lib/kia/bookings.ts allotKiaBookingVehicle) and the in-transit
--    arrival sweep (startKiaArrivedAllocationCountdowns), which re-derived the 72h / CSD-120h rule
--    in raw SQL. Without a stored window, an extension approved while a car was still on a truck
--    was SILENTLY DISCARDED when the clock later opened on arrival. Both paths now read
--    COALESCE(payment_window_hours, <policy default>).
--
--    NULL means "no explicit window recorded — the policy default applies", which is exactly how
--    every row behaved before this migration. There is deliberately NO BACKFILL: NULL is a
--    meaningful value here, not missing data, and the CSD flag that decides 72 vs 120 lives in
--    mutable kia_bookings.metadata, so a historical window cannot be reconstructed honestly.
--
-- 2. kia_payment_window_requests — who asked for more time, how long, why, and the MD's decision.
--    Column names mirror kia_booking_discounts (requested_* / action_* / status
--    PENDING|APPROVED|REJECTED) so the two approval queues read the same way.
--
-- Safe to run on production after `npm run db:backup`. Applied BY HAND — the drizzle journal is not
-- the source of truth in this repo. Run: npx tsx scripts/apply-migration-0035.ts

ALTER TABLE kia_vehicle_allocations
  ADD COLUMN IF NOT EXISTS payment_window_hours integer;

CREATE TABLE IF NOT EXISTS kia_payment_window_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- allocation_id is the SUBJECT of the approval (one car held for one booking). booking_id is
  -- denormalised so the MD queue and the booking drawer can both filter without a join, and
  -- vin_number is snapshotted for the same reason.
  booking_id          uuid NOT NULL REFERENCES kia_bookings (id) ON DELETE CASCADE,
  allocation_id       uuid NOT NULL REFERENCES kia_vehicle_allocations (id) ON DELETE CASCADE,
  vin_number          text NOT NULL,

  requested_days      integer NOT NULL,            -- 1..15, enforced in app code
  base_hours          integer NOT NULL,            -- the default window at request time (72 or 120)
  reason              text NOT NULL,               -- requester's justification, mandatory

  status              text NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  approved_days       integer,                     -- what the MD actually granted (may differ)

  requested_by        uuid NOT NULL REFERENCES users (id),
  requested_by_name   text NOT NULL,               -- snapshot: survives a rename or soft-delete

  -- One set of columns covers BOTH approve and reject, matching kia_booking_discounts.
  action_by           uuid REFERENCES users (id),
  action_by_name      text,
  action_remarks      text,
  action_at           timestamptz,

  -- What was actually written to kia_vehicle_allocations.expires_at, for audit. NULL on an approved
  -- in-transit allocation, where the extended window only starts when the vehicle arrives.
  applied_expires_at  timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kia_payment_window_requests_booking_idx
  ON kia_payment_window_requests (booking_id);

CREATE INDEX IF NOT EXISTS kia_payment_window_requests_status_idx
  ON kia_payment_window_requests (status);

CREATE INDEX IF NOT EXISTS kia_payment_window_requests_allocation_idx
  ON kia_payment_window_requests (allocation_id);

-- Makes a second pending request for the same allocation impossible at the DB level, so two
-- consultants cannot queue competing extensions for one car and have the MD action both.
CREATE UNIQUE INDEX IF NOT EXISTS kia_payment_window_requests_one_pending_idx
  ON kia_payment_window_requests (allocation_id)
  WHERE status = 'PENDING';
