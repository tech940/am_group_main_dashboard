CREATE INDEX IF NOT EXISTS idx_hyundai_warranty_claim_ytp_match_norm
  ON public.hyundai_warranty_claim_ytp (
    upper(trim(source_dealer_code)),
    upper(trim(r_o_no)),
    upper(trim(vin)),
    upper(trim(claim_type))
  );

CREATE INDEX IF NOT EXISTS idx_hyundai_warranty_claim_actions_created_at
  ON public.hyundai_warranty_claim_actions (created_at);
