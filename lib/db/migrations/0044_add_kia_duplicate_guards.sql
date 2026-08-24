-- DB-level backstop against duplicate KIA bookings.
--
-- ── Why ───────────────────────────────────────────────────────────────────────────────────────
-- createKiaBooking (lib/kia/bookings.ts) ALREADY rejects a same-day duplicate — same customer
-- phone, model and variant on the same IST day. That check is sound but it is only an application
-- check, and it has two holes:
--
--   1. IT IS NOT ATOMIC. The SELECT runs OUTSIDE the surrounding db.transaction, so two concurrent
--      submits can both pass it and both insert. At ~350ms per statement on this pooler that window
--      is wide enough to lose a double-click to.
--   2. IT ONLY COVERS THE APP. Anything writing straight to the table bypasses it entirely. That is
--      not hypothetical: scripts/process-21-vins.ts inserted 21 proformas in 38 seconds on
--      2026-08-07 (all login_email='system@amgroup.in'), two of which duplicated existing rows,
--      because a script does not go through the guarded route.
--
-- This index makes the SAME rule the application already enforces atomic and unbypassable. It is
-- deliberately not a wider rule: widening it would start rejecting business the app accepts today.
--
-- ⚠️ NOT a general "one booking per customer per model" constraint, on purpose. A repeat booking is
-- a first-class outcome in this product — 'repeated_booking' is a selectable status with its own
-- quick action in the Follow-ups page — and cancel-then-rebook is normal. Both stay possible: they
-- happen on a DIFFERENT DAY, so this index never sees them.
--
-- ── Normalisation matters here ────────────────────────────────────────────────────────────────
-- `model` and `variant` are NOT normalised consistently on write. Live rows contain both
-- 'NEW SELTOS DIESEL' and 'New Seltos Diesel'. An index on the raw columns would therefore miss
-- half the duplicates it exists to stop, so the index is on UPPER(BTRIM(...)) and the application
-- check must normalise identically or the two will disagree.
--
-- Verified before writing this: 0 same-day duplicate groups exist, so the index builds as-is.
--
-- Migrations here are applied BY HAND, on the direct/session port — DDL does not run through the
-- pgbouncer transaction pooler.

-- ── the same-day booking guard ────────────────────────────────────────────────────────────────
-- Partial (deleted_at IS NULL) so a soft-deleted booking never blocks a genuine re-entry, which is
-- the same exclusion the application check applies.
CREATE UNIQUE INDEX IF NOT EXISTS kia_bookings_same_day_unique_idx
  ON kia_bookings (
    customer_phone,
    UPPER(BTRIM(model)),
    UPPER(BTRIM(COALESCE(variant, ''))),
    ((timezone('Asia/Kolkata', created_at))::date)
  )
  WHERE deleted_at IS NULL;

-- ── supporting lookup for the application's own pre-check ─────────────────────────────────────
-- The guard SELECT filters on phone + model + variant + day. Without this it is a seq scan on every
-- booking creation; the table is small today but this is on the write path of every booking.
CREATE INDEX IF NOT EXISTS kia_bookings_dup_lookup_idx
  ON kia_bookings (customer_phone, created_at)
  WHERE deleted_at IS NULL;

ANALYZE kia_bookings;

-- ── NOT INCLUDED: the equivalent proforma index ───────────────────────────────────────────────
-- A matching same-day unique index on kia_proformas (mobile_number, UPPER(BTRIM(model_name)), IST
-- day) is the right shape, but it CANNOT BE CREATED YET: two historical same-day duplicate groups
-- exist and CREATE UNIQUE INDEX would fail on them.
--
--     8493974620  SONET              2026-07-16  x2   <- the 82-second double-submit
--     7298635047  NEW SELTOS PETROL  2026-07-23  x2
--
-- Both predate the route's duplicate guard (added 2026-07-25), so they are historical rather than a
-- live leak. Resolving them is a business decision — soft-delete the later row of each pair, or keep
-- both — so it is deliberately left out of this migration rather than guessed at. List them with:
--
--   SELECT mobile_number, UPPER(BTRIM(COALESCE(model_name,''))) AS model,
--          (timezone('Asia/Kolkata', created_at))::date AS ist_day,
--          COUNT(*)::int, ARRAY_AGG(id ORDER BY created_at)
--   FROM kia_proformas WHERE deleted_at IS NULL
--   GROUP BY 1,2,3 HAVING COUNT(*) > 1;
--
-- Once those are resolved, add the index in a follow-up migration:
--
--   CREATE UNIQUE INDEX IF NOT EXISTS kia_proformas_same_day_unique_idx
--     ON kia_proformas (mobile_number, UPPER(BTRIM(COALESCE(model_name, ''))),
--                       (timezone('Asia/Kolkata', created_at))::date)
--     WHERE deleted_at IS NULL;

-- Verify — expect 1 and 1.
-- SELECT
--   (SELECT COUNT(*) FROM pg_indexes
--     WHERE tablename='kia_bookings' AND indexname='kia_bookings_same_day_unique_idx')::int AS unique_idx,
--   (SELECT COUNT(*) FROM pg_indexes
--     WHERE tablename='kia_bookings' AND indexname='kia_bookings_dup_lookup_idx')::int      AS lookup_idx;
