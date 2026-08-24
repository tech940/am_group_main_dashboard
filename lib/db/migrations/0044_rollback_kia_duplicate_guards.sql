-- Complete rollback for 0044_add_kia_duplicate_guards.sql.
--
-- 0044 creates two indexes and nothing else — no table, no column, no data touched. Dropping them
-- returns the schema to exactly its prior shape and cannot lose a row.
--
-- ⚠️ Dropping the unique index re-opens the race it closes: the application check in
-- createKiaBooking runs OUTSIDE its transaction, so two concurrent submits can both pass it. The app
-- still rejects the ordinary sequential case, so this is a narrowing of protection, not a removal.
--
-- Run against the direct/session port — DDL does not run through the pgbouncer transaction pooler.

DROP INDEX IF EXISTS kia_bookings_dup_lookup_idx;
DROP INDEX IF EXISTS kia_bookings_same_day_unique_idx;

-- Verify the rollback landed — expect 0.
-- SELECT COUNT(*)::int AS indexes_remaining FROM pg_indexes
--  WHERE tablename = 'kia_bookings'
--    AND indexname IN ('kia_bookings_same_day_unique_idx', 'kia_bookings_dup_lookup_idx');
