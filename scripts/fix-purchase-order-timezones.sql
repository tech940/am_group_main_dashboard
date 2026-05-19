-- ============================================================================
-- Purchase Order and Workflow Timestamp Fix
-- ============================================================================
-- Converts purchase-order workflow timestamps to TIMESTAMPTZ so API responses
-- and relative-time UI labels stay correct for India users.
--
-- Assumptions:
-- - System-generated audit timestamps were stored as UTC wall-clock values.
-- - `received_date_time` represents local India wall-clock time.
-- ============================================================================

ALTER TABLE users
ALTER COLUMN created_at TYPE TIMESTAMPTZ
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE users
ALTER COLUMN updated_at TYPE TIMESTAMPTZ
USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE users
ALTER COLUMN deleted_at TYPE TIMESTAMPTZ
USING CASE
  WHEN deleted_at IS NULL THEN NULL
  ELSE deleted_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_orders
ALTER COLUMN created_at TYPE TIMESTAMPTZ
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE purchase_orders
ALTER COLUMN updated_at TYPE TIMESTAMPTZ
USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE purchase_orders
ALTER COLUMN completed_at TYPE TIMESTAMPTZ
USING CASE
  WHEN completed_at IS NULL THEN NULL
  ELSE completed_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_orders
ALTER COLUMN deleted_at TYPE TIMESTAMPTZ
USING CASE
  WHEN deleted_at IS NULL THEN NULL
  ELSE deleted_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_orders
ALTER COLUMN ea_approved_at TYPE TIMESTAMPTZ
USING CASE
  WHEN ea_approved_at IS NULL THEN NULL
  ELSE ea_approved_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_orders
ALTER COLUMN md_approved_at TYPE TIMESTAMPTZ
USING CASE
  WHEN md_approved_at IS NULL THEN NULL
  ELSE md_approved_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_orders
ALTER COLUMN received_date_time TYPE TIMESTAMPTZ
USING CASE
  WHEN received_date_time IS NULL THEN NULL
  ELSE received_date_time AT TIME ZONE 'Asia/Kolkata'
END;

ALTER TABLE purchase_orders
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE purchase_orders
ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE workflow_history
ALTER COLUMN created_at TYPE TIMESTAMPTZ
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE workflow_history
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE purchase_order_approvals
ALTER COLUMN approved_at TYPE TIMESTAMPTZ
USING CASE
  WHEN approved_at IS NULL THEN NULL
  ELSE approved_at AT TIME ZONE 'UTC'
END;

ALTER TABLE purchase_order_approvals
ALTER COLUMN created_at TYPE TIMESTAMPTZ
USING created_at AT TIME ZONE 'UTC';

ALTER TABLE purchase_order_approvals
ALTER COLUMN updated_at TYPE TIMESTAMPTZ
USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE purchase_order_approvals
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE purchase_order_approvals
ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  date_part TEXT;
  sequence_part TEXT;
  next_sequence INTEGER;
BEGIN
  date_part := TO_CHAR(timezone('Asia/Kolkata', NOW()), 'YYYYMMDD');

  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 13) AS INTEGER)), 0) + 1
  INTO next_sequence
  FROM purchase_orders
  WHERE order_number LIKE 'PO-' || date_part || '-%';

  sequence_part := LPAD(next_sequence::TEXT, 3, '0');

  RETURN 'PO-' || date_part || '-' || sequence_part;
END;
$$ LANGUAGE plpgsql;

SELECT 'Purchase order timestamps converted to timestamptz successfully.' AS message;
