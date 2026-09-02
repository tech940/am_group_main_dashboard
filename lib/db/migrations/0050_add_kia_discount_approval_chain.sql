-- 0050 — post-delivery discount requests get a three-stage approval chain.
--
-- ── What changes ──────────────────────────────────────────────────────────────────────────────
-- kia_booking_discounts already exists and is SINGLE stage: one `status` plus one action_by/at.
-- The flow is now:
--
--     requested -> Sales Manager -> MD -> Accounts confirm the money reached the customer
--
-- ⚠️ The existing `status`, `action_*` and `approved_amount` columns are LEFT IN PLACE and keep
-- their meaning as the OVERALL outcome. Two live PENDING requests already use them (Rs2,850 and
-- Rs1,50,000, both on delivered bookings); repurposing those columns would have silently rewritten
-- what somebody already submitted.
--
-- ── Why explicit per-stage columns rather than a jsonb chain ──────────────────────────────────
-- kia_approval_requests next door models its chain as one column per stage (vp_approval,
-- ea_approval, management_approval, account_approval). Following that shape means the two approval
-- queues read the same way, and a stage can be filtered and indexed in SQL rather than unpacked
-- from jsonb on every row.
--
-- Every stage column is NULLABLE and defaults to NULL = "this desk has not acted yet". No backfill:
-- the two existing rows are genuinely awaiting the first stage.

ALTER TABLE kia_booking_discounts
  -- What KIND of discount, chosen by the requester. Free text against a UI-supplied list rather than
  -- an enum: a new discount type must not need a migration, and a missing ALTER TYPE has taken this
  -- app down before.
  ADD COLUMN IF NOT EXISTS discount_type text,

  -- Stage 1 — Sales Manager. 'APPROVED' | 'REJECTED' | NULL.
  ADD COLUMN IF NOT EXISTS sm_status text,
  ADD COLUMN IF NOT EXISTS sm_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS sm_by_name text,
  ADD COLUMN IF NOT EXISTS sm_remarks text,
  ADD COLUMN IF NOT EXISTS sm_at timestamptz,

  -- Stage 2 — MD.
  ADD COLUMN IF NOT EXISTS md_status text,
  ADD COLUMN IF NOT EXISTS md_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS md_by_name text,
  ADD COLUMN IF NOT EXISTS md_remarks text,
  ADD COLUMN IF NOT EXISTS md_at timestamptz,
  -- The MD may grant less than was asked for. NULL means "as requested".
  ADD COLUMN IF NOT EXISTS md_approved_amount numeric(14,2),

  -- Stage 3 — Accounts confirm the discount actually reached the customer.
  -- 'PAID' | 'NOT_PAID' | NULL. Deliberately NOT called "approved": Accounts are recording a fact,
  -- not granting permission, and the wording is what stops that stage drifting into a fourth veto.
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS payout_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS payout_by_name text,
  ADD COLUMN IF NOT EXISTS payout_remarks text,
  ADD COLUMN IF NOT EXISTS payout_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_reference text,

  -- The delivered vehicle AS IT STOOD when the discount was requested: VIN, model, variant, colour,
  -- delivery date, consultant, price. Snapshotted because the booking keeps changing — a car can be
  -- re-allotted, a variant corrected — and an approver must see what they are approving against, not
  -- whatever the record looks like months later.
  ADD COLUMN IF NOT EXISTS vehicle_snapshot jsonb;

-- The approval queues filter on "what is waiting for me", which is a stage test, not a status test.
CREATE INDEX IF NOT EXISTS kia_booking_discounts_stage_idx
  ON kia_booking_discounts (sm_status, md_status, payout_status);

COMMENT ON COLUMN kia_booking_discounts.payout_status IS
  'Accounts recording whether the discount reached the customer: PAID | NOT_PAID | NULL. A record of fact, not a fourth approval.';
COMMENT ON COLUMN kia_booking_discounts.vehicle_snapshot IS
  'The delivered vehicle as it stood when the discount was requested. Frozen on purpose — the booking it came from keeps changing.';
