CREATE SEQUENCE IF NOT EXISTS public.kia_booking_number_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.kia_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'booking_created',
  dealer_code text NOT NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  customer_address text,
  model text NOT NULL,
  variant text NOT NULL,
  color text,
  fuel_type text,
  consultant_name text NOT NULL,
  consultant_email text,
  source text,
  finance_required boolean NOT NULL DEFAULT false,
  bank_name text,
  loan_amount numeric(14,2) NOT NULL DEFAULT 0,
  delivery_target_date date,
  delivered_at timestamptz,
  proforma_id uuid REFERENCES public.kia_proformas(id) ON DELETE SET NULL,
  finance_order_id uuid REFERENCES public.finance_orders(id) ON DELETE SET NULL,
  allocated_vin text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.kia_booking_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.kia_bookings(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  title text NOT NULL,
  description text,
  before_value jsonb,
  after_value jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  actor_name text,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kia_vehicle_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.kia_bookings(id) ON DELETE CASCADE,
  vin_number text NOT NULL,
  dealer_code text,
  model text,
  variant text,
  color text,
  engine_no text,
  stock_source text NOT NULL DEFAULT 'dms',
  vehicle_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  allocated_by uuid NOT NULL REFERENCES public.users(id),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kia_vehicle_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.kia_bookings(id) ON DELETE CASCADE,
  vin_number text,
  from_dealer_code text,
  to_dealer_code text NOT NULL,
  transfer_status text NOT NULL DEFAULT 'requested',
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kia_bookings_number_idx ON public.kia_bookings (booking_number);
CREATE INDEX IF NOT EXISTS kia_bookings_dealer_status_created_idx ON public.kia_bookings (dealer_code, status, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_bookings_consultant_created_idx ON public.kia_bookings (consultant_name, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_bookings_customer_phone_idx ON public.kia_bookings (customer_phone);
CREATE INDEX IF NOT EXISTS kia_bookings_allocated_vin_idx ON public.kia_bookings (allocated_vin);
CREATE INDEX IF NOT EXISTS kia_bookings_proforma_idx ON public.kia_bookings (proforma_id);
CREATE INDEX IF NOT EXISTS kia_bookings_finance_order_idx ON public.kia_bookings (finance_order_id);

CREATE INDEX IF NOT EXISTS kia_booking_activity_booking_created_idx ON public.kia_booking_activity (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_booking_activity_actor_created_idx ON public.kia_booking_activity (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_booking_activity_type_created_idx ON public.kia_booking_activity (activity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_booking_created_idx ON public.kia_vehicle_allocations (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_vin_created_idx ON public.kia_vehicle_allocations (vin_number, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_dealer_idx ON public.kia_vehicle_allocations (dealer_code);
CREATE UNIQUE INDEX IF NOT EXISTS kia_vehicle_allocations_active_vin_idx ON public.kia_vehicle_allocations (vin_number) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kia_vehicle_allocations_active_booking_idx ON public.kia_vehicle_allocations (booking_id) WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS kia_vehicle_transfers_booking_created_idx ON public.kia_vehicle_transfers (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_vehicle_transfers_vin_created_idx ON public.kia_vehicle_transfers (vin_number, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_vehicle_transfers_dealer_status_idx ON public.kia_vehicle_transfers (from_dealer_code, to_dealer_code, transfer_status);

ALTER TABLE public.kia_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kia_booking_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kia_vehicle_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kia_vehicle_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kia_bookings' AND policyname = 'kia_bookings_authenticated_kia_users') THEN
    CREATE POLICY kia_bookings_authenticated_kia_users ON public.kia_bookings
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.supabase_id = (SELECT auth.uid())::text
          AND u.deleted_at IS NULL
          AND u.is_active
          AND (u.role IN ('admin', 'developer', 'ceo', 'md') OR lower(coalesce(u.brand, '')) IN ('kia', 'all'))
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.supabase_id = (SELECT auth.uid())::text
          AND u.deleted_at IS NULL
          AND u.is_active
          AND (u.role IN ('admin', 'developer', 'ceo', 'md') OR lower(coalesce(u.brand, '')) IN ('kia', 'all'))
      ));
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['kia_booking_activity', 'kia_vehicle_allocations', 'kia_vehicle_transfers']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = table_name || '_authenticated_kia_users') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.supabase_id = (SELECT auth.uid())::text
            AND u.deleted_at IS NULL
            AND u.is_active
            AND (u.role IN (''admin'', ''developer'', ''ceo'', ''md'') OR lower(coalesce(u.brand, '''')) IN (''kia'', ''all''))
        )) WITH CHECK (EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.supabase_id = (SELECT auth.uid())::text
            AND u.deleted_at IS NULL
            AND u.is_active
            AND (u.role IN (''admin'', ''developer'', ''ceo'', ''md'') OR lower(coalesce(u.brand, '''')) IN (''kia'', ''all''))
        ))',
        table_name || '_authenticated_kia_users',
        table_name
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.kia_bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kia_booking_activity TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kia_vehicle_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kia_vehicle_transfers TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.kia_booking_number_seq TO authenticated;
