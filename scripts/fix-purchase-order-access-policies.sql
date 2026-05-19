-- Align Purchase Order RLS with the role-based workflow rules.

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can update their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can delete their own purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can view all purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Admins and managers can update all purchase orders" ON purchase_orders;
DROP POLICY IF EXISTS "Users can create initial submissions" ON purchase_orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON purchase_orders;
DROP POLICY IF EXISTS "Purchase Managers can manage vendor and GRN" ON purchase_orders;
DROP POLICY IF EXISTS "EA can view and approve" ON purchase_orders;
DROP POLICY IF EXISTS "MD can view and approve" ON purchase_orders;
DROP POLICY IF EXISTS "Accounts can manage accounts stage" ON purchase_orders;
DROP POLICY IF EXISTS "Admin has full access" ON purchase_orders;
DROP POLICY IF EXISTS "Purchase order insert policy" ON purchase_orders;
DROP POLICY IF EXISTS "Purchase order select policy" ON purchase_orders;
DROP POLICY IF EXISTS "Purchase order update policy" ON purchase_orders;
DROP POLICY IF EXISTS "Purchase order delete policy" ON purchase_orders;

DROP POLICY IF EXISTS "Users can view workflow history of their orders" ON workflow_history;
DROP POLICY IF EXISTS "Authorized users can view all workflow history" ON workflow_history;
DROP POLICY IF EXISTS "System can insert workflow history" ON workflow_history;
DROP POLICY IF EXISTS "Workflow history select policy" ON workflow_history;
DROP POLICY IF EXISTS "Workflow history insert policy" ON workflow_history;

CREATE POLICY "Purchase order insert policy"
ON purchase_orders
FOR INSERT
TO authenticated
WITH CHECK (
  deleted_at IS NULL
  AND created_by IN (
    SELECT u.id
    FROM users u
    WHERE u.supabase_id::text = auth.uid()::text
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND u.role IN ('admin', 'purchase_manager')
  )
);

CREATE POLICY "Purchase order select policy"
ON purchase_orders
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.supabase_id::text = auth.uid()::text
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND (
        u.role IN ('admin', 'md', 'purchase_manager')
        OR purchase_orders.assigned_to = u.id
        OR (
          u.role = 'ea'
          AND (
            purchase_orders.status IN (
              'awaiting_ea_approval',
              'awaiting_md_approval',
              'awaiting_grn',
              'awaiting_accounts',
              'completed',
              'ea_denied',
              'md_denied'
            )
            OR purchase_orders.ea_approved_by = u.id
          )
        )
        OR (
          u.role = 'accounts'
          AND purchase_orders.status IN ('awaiting_accounts', 'completed')
        )
        OR (
          u.role IN ('manager', 'technician', 'viewer')
          AND (
            purchase_orders.created_by = u.id
            OR purchase_orders.requested_by = u.full_name
            OR purchase_orders.requested_by = u.email
          )
        )
      )
  )
);

CREATE POLICY "Purchase order update policy"
ON purchase_orders
FOR UPDATE
TO authenticated
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM users u
    WHERE u.supabase_id::text = auth.uid()::text
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND (
        u.role = 'admin'
        OR u.role = 'purchase_manager'
        OR (
          u.role = 'ea'
          AND purchase_orders.status = 'awaiting_ea_approval'
        )
        OR (
          u.role = 'md'
          AND purchase_orders.status = 'awaiting_md_approval'
        )
        OR (
          u.role = 'accounts'
          AND purchase_orders.status = 'awaiting_accounts'
        )
      )
  )
)
WITH CHECK (
  deleted_at IS NULL
);

CREATE POLICY "Purchase order delete policy"
ON purchase_orders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.supabase_id::text = auth.uid()::text
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND u.role IN ('admin', 'purchase_manager')
      AND (purchase_orders.created_by = u.id OR purchase_orders.assigned_to = u.id)
  )
);

CREATE POLICY "Workflow history select policy"
ON workflow_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM purchase_orders po
    JOIN users u ON u.supabase_id::text = auth.uid()::text
    WHERE po.id = workflow_history.purchase_order_id
      AND po.deleted_at IS NULL
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND (
        u.role IN ('admin', 'md', 'purchase_manager')
        OR po.assigned_to = u.id
        OR (
          u.role = 'ea'
          AND (
            po.status IN (
              'awaiting_ea_approval',
              'awaiting_md_approval',
              'awaiting_grn',
              'awaiting_accounts',
              'completed',
              'ea_denied',
              'md_denied'
            )
            OR po.ea_approved_by = u.id
          )
        )
        OR (
          u.role = 'accounts'
          AND po.status IN ('awaiting_accounts', 'completed')
        )
        OR (
          u.role IN ('manager', 'technician', 'viewer')
          AND (
            po.created_by = u.id
            OR po.requested_by = u.full_name
            OR po.requested_by = u.email
          )
        )
      )
  )
);

CREATE POLICY "Workflow history insert policy"
ON workflow_history
FOR INSERT
TO authenticated
WITH CHECK (
  performed_by IN (
    SELECT u.id
    FROM users u
    WHERE u.supabase_id::text = auth.uid()::text
      AND u.deleted_at IS NULL
      AND u.is_active = true
      AND u.role IN ('admin', 'purchase_manager', 'ea', 'md', 'accounts')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_orders TO authenticated;
GRANT SELECT, INSERT ON workflow_history TO authenticated;

SELECT 'Purchase order access policies updated successfully.' AS message;
