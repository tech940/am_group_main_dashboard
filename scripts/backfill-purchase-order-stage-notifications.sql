-- Backfill queue notifications for purchase orders that are already waiting
-- in a workflow stage. Safe to run repeatedly.

INSERT INTO notifications (
  user_id,
  title,
  message,
  type,
  action_url,
  purchase_order_id,
  reference_number,
  workflow_stage,
  target_role,
  dedupe_key,
  metadata
)
SELECT
  u.id,
  CASE po.status::text
    WHEN 'awaiting_ea_approval' THEN 'Purchase order awaiting EA approval'
    WHEN 'awaiting_md_approval' THEN 'Purchase order awaiting MD approval'
    WHEN 'awaiting_grn' THEN 'Purchase order awaiting GRN'
    WHEN 'awaiting_accounts' THEN 'Purchase order awaiting accounts processing'
  END AS title,
  CASE po.status::text
    WHEN 'awaiting_ea_approval' THEN po.order_number || ' is ready for EA approval.'
    WHEN 'awaiting_md_approval' THEN po.order_number || ' is ready for MD approval.'
    WHEN 'awaiting_grn' THEN po.order_number || ' is ready for GRN processing.'
    WHEN 'awaiting_accounts' THEN po.order_number || ' is ready for accounts processing.'
  END AS message,
  'info',
  '/purchase-orders?orderId=' || po.id::text,
  po.id,
  po.order_number,
  CASE po.status::text
    WHEN 'awaiting_ea_approval' THEN 'ea_approval'
    WHEN 'awaiting_md_approval' THEN 'md_approval'
    WHEN 'awaiting_grn' THEN 'grn'
    WHEN 'awaiting_accounts' THEN 'accounts'
  END AS workflow_stage,
  u.role,
  'po-stage:' || po.id::text || ':' || po.status::text,
  jsonb_build_object(
    'event', 'stage_notification_backfill',
    'orderStatus', po.status::text
  )
FROM purchase_orders po
JOIN users u
  ON u.deleted_at IS NULL
  AND u.is_active = true
  AND (
    (po.status = 'awaiting_ea_approval' AND u.role = 'ea')
    OR (po.status = 'awaiting_md_approval' AND u.role = 'md')
    OR (po.status = 'awaiting_grn' AND u.role = 'purchase_manager')
    OR (po.status = 'awaiting_accounts' AND u.role = 'accounts')
  )
WHERE po.deleted_at IS NULL
  AND po.status IN ('awaiting_ea_approval', 'awaiting_md_approval', 'awaiting_grn', 'awaiting_accounts')
ON CONFLICT (user_id, dedupe_key) DO NOTHING;
