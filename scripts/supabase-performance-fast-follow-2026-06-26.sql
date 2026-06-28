-- Fast-follow indexes for the highest-value application query paths.
-- Apply during a maintenance window if you want the DB changes live immediately.

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_history_purchase_order_created_idx
  ON public.workflow_history (purchase_order_id, created_at ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS finance_order_workflow_order_created_idx
  ON public.finance_order_workflow (finance_order_id, created_at ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS users_role_active_brand_idx
  ON public.users (role, is_active, brand)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS purchase_orders_brand_status_created_idx
  ON public.purchase_orders (brand, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS kia_proformas_owner_date_idx
  ON public.kia_proformas (login_email, proforma_date DESC, entry_time DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS mg_proformas_owner_date_idx
  ON public.mg_proformas (login_email, proforma_date DESC, entry_time DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS finance_sheet_mobile_digits_delivery_idx
  ON public.finance_sheet (
    regexp_replace(coalesce(mobile_no, ''), '\D', '', 'g'),
    delivery_date DESC,
    id DESC
  );
