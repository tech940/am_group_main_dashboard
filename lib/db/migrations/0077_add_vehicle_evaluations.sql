-- 0077_add_vehicle_evaluations.sql
CREATE TABLE IF NOT EXISTS public.vehicle_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  country_code text NOT NULL DEFAULT '+91',
  mobile text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  manufacturing_year integer NOT NULL,
  fuel_type text,
  transmission text,
  kilometers_driven text,
  mileage_exact integer,
  evaluation_date text,
  city_area text NOT NULL DEFAULT 'Jammu City',
  interested_in_new_car boolean NOT NULL DEFAULT false,
  estimated_price_min decimal(10, 2),
  estimated_price_max decimal(10, 2),
  uploaded_photos jsonb DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'whatsapp_campaign',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_evaluations_created_idx ON public.vehicle_evaluations (created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_evaluations_mobile_idx ON public.vehicle_evaluations (mobile);
CREATE INDEX IF NOT EXISTS vehicle_evaluations_status_idx ON public.vehicle_evaluations (status);
CREATE INDEX IF NOT EXISTS vehicle_evaluations_brand_idx ON public.vehicle_evaluations (brand);

ALTER TABLE public.vehicle_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_evaluations FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.vehicle_evaluations TO service_role;
