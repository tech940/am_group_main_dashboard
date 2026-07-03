ALTER TABLE public.kia_vehicle_allocations
  ADD COLUMN IF NOT EXISTS allocation_status text NOT NULL DEFAULT 'temporary',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_expiry_idx
  ON public.kia_vehicle_allocations (allocation_status, expires_at)
  WHERE released_at IS NULL AND payment_confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS kia_vehicle_allocations_payment_idx
  ON public.kia_vehicle_allocations (payment_confirmed_at DESC)
  WHERE payment_confirmed_at IS NOT NULL;
