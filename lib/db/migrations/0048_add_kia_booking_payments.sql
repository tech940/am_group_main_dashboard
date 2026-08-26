-- KIA part payments: an append-only ledger per booking, plus the "secured" exemption that keeps a
-- substantially-paid vehicle out of the auto-release sweep.
--
-- ── Why a new table and not kia_receipt_report ────────────────────────────────────────────────
-- kia_receipt_report already holds one row per receipt against a booking, but it is an EXTERNALLY
-- INGESTED DMS feed (lib/kia/receipt-report.ts, registered in lib/data-health/feeds.ts, and anon
-- INSERT/UPDATE/DELETE was revoked on it in 0038). The pipeline owns it; we must never write there.
-- So the app needs its own ledger. The two will describe the same money from different sides;
-- reconciling them is deliberately a later job.
--
-- ── Append-only, because this is money ────────────────────────────────────────────────────────
-- A mistyped amount is corrected by adding a REVERSAL row, never by editing or deleting. The CHECK
-- constraints below make that structural rather than a convention a future edit could quietly drop:
-- a 'payment' must be positive with no parent, a 'reversal' must be negative and must name the row
-- it reverses. Same shape as petty_cash_ledger_entries.
--
-- ── Keyed on the BOOKING, not the allocation ──────────────────────────────────────────────────
-- Under the threshold a lapsed reservation still returns the car to free stock, and the customer's
-- money must survive that and follow them if another car is allotted. allocation_id/vin_number are
-- recorded for provenance only — which car the money was taken against at the time.
--
-- Migrations here are applied BY HAND on the direct/session port (never the pgbouncer pooler).
-- Run: npx tsx scripts/apply-migration-0048.ts

CREATE TABLE IF NOT EXISTS kia_booking_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES kia_bookings(id) ON DELETE CASCADE,
  allocation_id    uuid REFERENCES kia_vehicle_allocations(id) ON DELETE SET NULL,
  vin_number       text,
  entry_type       text NOT NULL,
  -- Rupees, never paise — the house convention across every money column in this schema.
  amount           numeric(14,2) NOT NULL,
  reverses_id      uuid REFERENCES kia_booking_payments(id),
  -- The running total AFTER this row. A snapshot for the audit trail; the authoritative figure is
  -- kia_bookings.amount_received, which is incremented atomically in the same transaction.
  total_after      numeric(14,2) NOT NULL,
  payment_mode     text,
  reference        text,
  received_on      date,
  notes            text,
  recorded_by      uuid NOT NULL REFERENCES users(id),
  recorded_by_name text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kia_booking_payments_amount_check CHECK (amount <> 0),
  CONSTRAINT kia_booking_payments_kind_check CHECK (
    (entry_type = 'payment'  AND amount > 0 AND reverses_id IS NULL)
    OR (entry_type = 'reversal' AND amount < 0 AND reverses_id IS NOT NULL)
  )
);

COMMENT ON TABLE kia_booking_payments IS
  'Append-only part-payment ledger for KIA bookings. Corrections are reversal rows; nothing is ever '
  'edited or deleted. Distinct from kia_receipt_report, which is the read-only DMS feed.';

-- The drill-down reads one booking newest-first.
CREATE INDEX IF NOT EXISTS kia_booking_payments_booking_idx
  ON kia_booking_payments (booking_id, created_at DESC);

-- One reversal per original entry: without this a double-clicked Reverse silently halves the total.
CREATE UNIQUE INDEX IF NOT EXISTS kia_booking_payments_reverses_idx
  ON kia_booking_payments (reverses_id) WHERE reverses_id IS NOT NULL;

-- ── Running total on the parent ───────────────────────────────────────────────────────────────
-- Stored rather than SUM-on-read: the stock list renders up to 100 rows and needs this figure on
-- every one, against a pooler that charges ~225ms per statement.
--
-- DEFAULT 0 is correct here and is NOT the "NULL is not zero" case that applies to targets: a
-- booking with no payments has genuinely received zero.
ALTER TABLE kia_bookings
  ADD COLUMN IF NOT EXISTS amount_received numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN kia_bookings.amount_received IS
  'Sum of kia_booking_payments for this booking (reversals included, so it can go down). Maintained '
  'atomically in the same transaction as the ledger insert. Survives a lapsed allocation.';

-- Guards against a reversal race driving the total negative. Dropped first so re-running this
-- migration is a no-op: plain ADD CONSTRAINT errors if it already exists, and every other statement
-- in this file is IF NOT EXISTS.
ALTER TABLE kia_bookings DROP CONSTRAINT IF EXISTS kia_bookings_amount_received_check;
ALTER TABLE kia_bookings
  ADD CONSTRAINT kia_bookings_amount_received_check CHECK (amount_received >= 0);

-- ── The secured flag ──────────────────────────────────────────────────────────────────────────
ALTER TABLE kia_vehicle_allocations
  ADD COLUMN IF NOT EXISTS payment_secured_at timestamptz;

COMMENT ON COLUMN kia_vehicle_allocations.payment_secured_at IS
  'Set once the booking total crosses the secured threshold (see KIA_PAYMENT_SECURED_THRESHOLD in '
  'lib/kia/bookings.ts). While non-NULL the reservation clock is suspended: expireKiaTemporaryAllocations '
  'must not release the vehicle and startKiaArrivedAllocationCountdowns must not open a clock on arrival. '
  'expires_at is deliberately LEFT IN PLACE so the original deadline stays visible and a reversal that '
  'drops the total back below the threshold can re-arm the clock.';

-- Partial index: the sweep asks for these, and there will only ever be a handful.
CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_secured_idx
  ON kia_vehicle_allocations (payment_secured_at) WHERE payment_secured_at IS NOT NULL;

ANALYZE kia_booking_payments;
ANALYZE kia_bookings;
ANALYZE kia_vehicle_allocations;
