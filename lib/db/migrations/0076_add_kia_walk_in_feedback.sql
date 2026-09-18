-- 0076_add_kia_walk_in_feedback.sql
CREATE TABLE IF NOT EXISTS public.kia_walk_in_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  walk_in_lead_id uuid REFERENCES public.kia_walk_in_leads(id) ON DELETE SET NULL,
  dealer_code text NOT NULL DEFAULT 'JK402',
  customer_name text NOT NULL,
  country_code text NOT NULL DEFAULT '+91',
  mobile text NOT NULL,
  model text,
  consultant_name text,
  overall_rating smallint NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  staff_courtesy_rating smallint CHECK (staff_courtesy_rating BETWEEN 1 AND 5),
  test_drive_rating smallint CHECK (test_drive_rating BETWEEN 1 AND 5),
  showroom_ambience_rating smallint CHECK (showroom_ambience_rating BETWEEN 1 AND 5),
  experience_tags jsonb,
  remarks text,
  source text NOT NULL DEFAULT 'qr_feedback',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kia_walk_in_feedback_dealer_created_idx ON public.kia_walk_in_feedback (dealer_code, created_at DESC);
CREATE INDEX IF NOT EXISTS kia_walk_in_feedback_mobile_idx ON public.kia_walk_in_feedback (mobile);
CREATE INDEX IF NOT EXISTS kia_walk_in_feedback_rating_idx ON public.kia_walk_in_feedback (overall_rating);
ALTER TABLE public.kia_walk_in_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kia_walk_in_feedback FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.kia_walk_in_feedback TO service_role;
