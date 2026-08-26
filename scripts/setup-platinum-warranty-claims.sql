CREATE TABLE IF NOT EXISTS public.platinum_warranty_claim_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('ytp', 'claim_list')),
  record_key text NOT NULL,
  requirement_code text NOT NULL,
  status_snapshot text,
  business_date_snapshot date,
  remark text NOT NULL CHECK (btrim(remark) <> ''),
  docket_number text,
  created_by uuid REFERENCES public.users(id),
  created_by_name text NOT NULL,
  created_by_email text NOT NULL,
  created_by_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platinum_warranty_claim_actions_record_idx
  ON public.platinum_warranty_claim_actions (source_type, record_key, created_at DESC);
CREATE INDEX IF NOT EXISTS platinum_warranty_claim_actions_requirement_idx
  ON public.platinum_warranty_claim_actions (source_type, record_key, requirement_code, status_snapshot);
CREATE INDEX IF NOT EXISTS platinum_warranty_claim_actions_actor_idx
  ON public.platinum_warranty_claim_actions (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platinum_warranty_claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.platinum_warranty_claim_actions(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platinum_warranty_claim_evidence_action_idx
  ON public.platinum_warranty_claim_evidence (action_id, created_at);

CREATE TABLE IF NOT EXISTS public.platinum_warranty_dealer_mappings (
  dealer_code text PRIMARY KEY,
  dealer_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platinum_warranty_dealer_mappings_name_idx
  ON public.platinum_warranty_dealer_mappings (dealer_name);

INSERT INTO public.platinum_warranty_dealer_mappings (dealer_code, dealer_name)
VALUES
  ('N5211', 'Platinum Jammu'),
  ('N6250', 'Platinum Rajouri'),
  ('N6828', 'Platinum Poonch'),
  ('N6824', 'Platinum Rajouri (Legacy)')
ON CONFLICT (dealer_code) DO UPDATE
SET dealer_name = EXCLUDED.dealer_name,
    is_active = true,
    updated_at = now();
