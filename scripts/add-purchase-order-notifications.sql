-- ============================================================================
-- Purchase Order Notifications Migration
-- ============================================================================
-- Adds workflow-aware notification fields, dedupe support, RLS, and Realtime
-- publication wiring for the purchase order notification bell.
-- ============================================================================

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS purchase_order_id UUID,
ADD COLUMN IF NOT EXISTS reference_number TEXT,
ADD COLUMN IF NOT EXISTS workflow_stage TEXT,
ADD COLUMN IF NOT EXISTS target_role role,
ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb NOT NULL;

UPDATE notifications
SET
  dedupe_key = COALESCE(dedupe_key, id::text),
  metadata = COALESCE(metadata, '{}'::jsonb)
WHERE dedupe_key IS NULL OR metadata IS NULL;

ALTER TABLE notifications
ALTER COLUMN dedupe_key SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'created_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE notifications
      ALTER COLUMN created_at TYPE TIMESTAMPTZ
      USING created_at AT TIME ZONE 'UTC'
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'read_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE notifications
      ALTER COLUMN read_at TYPE TIMESTAMPTZ
      USING CASE
        WHEN read_at IS NULL THEN NULL
        ELSE read_at AT TIME ZONE 'UTC'
      END
    $sql$;
  END IF;
END $$;

ALTER TABLE notifications
ALTER COLUMN created_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_purchase_order_idx
ON notifications(purchase_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_idx
ON notifications(user_id, dedupe_key);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can do everything" ON notifications;

DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
CREATE POLICY "Users can view their own notifications"
ON notifications FOR SELECT
TO authenticated
USING (
  user_id IN (
    SELECT id
    FROM users
    WHERE supabase_id::text = auth.uid()::text
  )
);

DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
CREATE POLICY "Users can update their own notifications"
ON notifications FOR UPDATE
TO authenticated
USING (
  user_id IN (
    SELECT id
    FROM users
    WHERE supabase_id::text = auth.uid()::text
  )
)
WITH CHECK (
  user_id IN (
    SELECT id
    FROM users
    WHERE supabase_id::text = auth.uid()::text
  )
);

GRANT SELECT, UPDATE ON notifications TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN invalid_object_definition THEN null;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN invalid_object_definition THEN null;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE workflow_history;
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN invalid_object_definition THEN null;
END $$;

SELECT 'Purchase order notifications migration completed successfully.' AS message;
