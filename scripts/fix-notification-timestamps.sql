-- ============================================================================
-- Notification Timestamp Fix
-- ============================================================================
-- Converts notification timestamps to timestamptz so relative times render
-- correctly for users outside UTC.
-- Existing values are assumed to have been stored as UTC wall-clock time.
-- ============================================================================

ALTER TABLE notifications
ALTER COLUMN created_at TYPE TIMESTAMPTZ
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE notifications
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE notifications
ALTER COLUMN read_at TYPE TIMESTAMPTZ
USING CASE
  WHEN read_at IS NULL THEN NULL
  ELSE read_at AT TIME ZONE 'UTC'
END;

SELECT 'Notification timestamps converted to timestamptz successfully.' AS message;
