-- Rollback of 0073 (two-stage approval). Drops only what 0073 added. The manager-stage history in
-- tata_h_promise_events is kept (the events table is append-only by design).
ALTER TABLE public.tata_h_promise_vehicles
  DROP CONSTRAINT IF EXISTS tata_h_promise_vehicles_purchase_manager_status,
  DROP CONSTRAINT IF EXISTS tata_h_promise_vehicles_sale_manager_status,
  DROP CONSTRAINT IF EXISTS tata_h_promise_vehicles_purchase_manager_not_self,
  DROP CONSTRAINT IF EXISTS tata_h_promise_vehicles_sale_manager_not_self,
  DROP COLUMN IF EXISTS purchase_manager_status,
  DROP COLUMN IF EXISTS purchase_manager_by,
  DROP COLUMN IF EXISTS purchase_manager_by_name,
  DROP COLUMN IF EXISTS purchase_manager_role,
  DROP COLUMN IF EXISTS purchase_manager_at,
  DROP COLUMN IF EXISTS purchase_manager_note,
  DROP COLUMN IF EXISTS purchase_decided_role,
  DROP COLUMN IF EXISTS sale_manager_status,
  DROP COLUMN IF EXISTS sale_manager_by,
  DROP COLUMN IF EXISTS sale_manager_by_name,
  DROP COLUMN IF EXISTS sale_manager_role,
  DROP COLUMN IF EXISTS sale_manager_at,
  DROP COLUMN IF EXISTS sale_manager_note,
  DROP COLUMN IF EXISTS sale_decided_role;
