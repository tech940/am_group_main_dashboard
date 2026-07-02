CREATE TABLE IF NOT EXISTS public.kia_stock_local_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin_number text NOT NULL UNIQUE,
  local_status text NOT NULL CHECK (local_status IN ('bbnd', 'retail')),
  dealer_code text,
  model text,
  variant text,
  color text,
  engine_no text,
  kin_invoice_no text,
  kin_invoice_date text,
  order_no text,
  stock_status_at_mark text,
  stock_location text,
  booking_no text,
  customer_id text,
  customer_name text,
  basic_price numeric(14, 2),
  vehicle_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_uploaded_at timestamptz,
  notes text,
  marked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  marked_by_name text,
  marked_by_role text,
  marked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kia_stock_local_statuses_vin_idx
  ON public.kia_stock_local_statuses (vin_number);

CREATE INDEX IF NOT EXISTS kia_stock_local_statuses_status_marked_idx
  ON public.kia_stock_local_statuses (local_status, marked_at DESC);

CREATE INDEX IF NOT EXISTS kia_stock_local_statuses_dealer_status_idx
  ON public.kia_stock_local_statuses (dealer_code, local_status);

ALTER TABLE public.kia_stock_local_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "KIA stock local statuses readable by KIA users" ON public.kia_stock_local_statuses;
CREATE POLICY "KIA stock local statuses readable by KIA users"
  ON public.kia_stock_local_statuses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.supabase_id = (SELECT auth.uid())::text
        AND u.deleted_at IS NULL
        AND u.is_active = true
        AND (
          u.role IN ('super_admin', 'admin', 'md', 'manager', 'branch_admin')
          OR u.brand IN ('kia', 'all')
        )
    )
  );

DROP POLICY IF EXISTS "KIA stock local statuses writable by KIA sales users" ON public.kia_stock_local_statuses;
CREATE POLICY "KIA stock local statuses writable by KIA sales users"
  ON public.kia_stock_local_statuses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.supabase_id = (SELECT auth.uid())::text
        AND u.deleted_at IS NULL
        AND u.is_active = true
        AND (
          u.role IN ('super_admin', 'admin', 'md', 'manager', 'branch_admin')
          OR u.brand IN ('kia', 'all')
        )
    )
  );

DROP POLICY IF EXISTS "KIA stock local statuses updatable by KIA sales users" ON public.kia_stock_local_statuses;
CREATE POLICY "KIA stock local statuses updatable by KIA sales users"
  ON public.kia_stock_local_statuses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.supabase_id = (SELECT auth.uid())::text
        AND u.deleted_at IS NULL
        AND u.is_active = true
        AND (
          u.role IN ('super_admin', 'admin', 'md', 'manager', 'branch_admin')
          OR u.brand IN ('kia', 'all')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.supabase_id = (SELECT auth.uid())::text
        AND u.deleted_at IS NULL
        AND u.is_active = true
        AND (
          u.role IN ('super_admin', 'admin', 'md', 'manager', 'branch_admin')
          OR u.brand IN ('kia', 'all')
        )
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.kia_stock_local_statuses TO authenticated;
