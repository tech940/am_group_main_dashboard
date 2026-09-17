-- ============================================================================================================
-- 0073 · AM Tata · H Promise — two-stage approval (owner decision, 2026-09-17)
--
--   1. The General Sales Manager or a Sales Manager approves (the "manager" stage);
--   2. the MD gives the final approval — and may do so while the manager stage is still waiting.
--
-- `purchase_status` / `sale_status` keep their meaning: the OVERALL state (pending | approved | rejected), and
-- `approved` still means finally approved, so the price-lock trigger from 0072 is unchanged. The new columns
-- record the manager stage beside it:
--
--   *_manager_status   NULL | pending | approved | rejected | skipped
--                      NULL on rows written before this migration: the app reads it as "pending" while the
--                      overall status is pending, and as "skipped" once it was decided (the sheet import).
--                      `skipped` = the MD decided before any manager did.
--   *_manager_by …     who decided the manager stage, their role and name, when, and their note/reason
--   *_decided_role     the role of whoever made the overall decision (md / developer), so "Approved by MD"
--                      can tell the MD's approval from an imported sheet approval (NULL).
--
-- ADDITIVE ONLY: nullable columns, NULL-safe CHECKs, no data is changed. Rollback: 0073_rollback_….sql.
-- ⚠️ Apply with scripts/apply-migration-0073.ts (session pooler, port 5432). Never on the 6543 pooler.
-- ============================================================================================================

ALTER TABLE public.tata_h_promise_vehicles
  ADD COLUMN IF NOT EXISTS purchase_manager_status   text,
  ADD COLUMN IF NOT EXISTS purchase_manager_by       uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS purchase_manager_by_name  text,
  ADD COLUMN IF NOT EXISTS purchase_manager_role     text,
  ADD COLUMN IF NOT EXISTS purchase_manager_at       timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_manager_note     text,
  ADD COLUMN IF NOT EXISTS purchase_decided_role     text,
  ADD COLUMN IF NOT EXISTS sale_manager_status       text,
  ADD COLUMN IF NOT EXISTS sale_manager_by           uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS sale_manager_by_name      text,
  ADD COLUMN IF NOT EXISTS sale_manager_role         text,
  ADD COLUMN IF NOT EXISTS sale_manager_at           timestamptz,
  ADD COLUMN IF NOT EXISTS sale_manager_note         text,
  ADD COLUMN IF NOT EXISTS sale_decided_role         text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tata_h_promise_vehicles_purchase_manager_status') THEN
    ALTER TABLE public.tata_h_promise_vehicles ADD CONSTRAINT tata_h_promise_vehicles_purchase_manager_status
      CHECK (purchase_manager_status IS NULL OR purchase_manager_status IN ('pending', 'approved', 'rejected', 'skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tata_h_promise_vehicles_sale_manager_status') THEN
    ALTER TABLE public.tata_h_promise_vehicles ADD CONSTRAINT tata_h_promise_vehicles_sale_manager_status
      CHECK (sale_manager_status IS NULL OR sale_manager_status IN ('pending', 'approved', 'rejected', 'skipped'));
  END IF;
  -- No self-approval at the manager stage either (NULL-safe, like 0072's).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tata_h_promise_vehicles_purchase_manager_not_self') THEN
    ALTER TABLE public.tata_h_promise_vehicles ADD CONSTRAINT tata_h_promise_vehicles_purchase_manager_not_self
      CHECK (
        purchase_manager_by IS NULL
        OR ((created_by IS NULL OR purchase_manager_by <> created_by)
            AND (purchase_submitted_by IS NULL OR purchase_manager_by <> purchase_submitted_by))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tata_h_promise_vehicles_sale_manager_not_self') THEN
    ALTER TABLE public.tata_h_promise_vehicles ADD CONSTRAINT tata_h_promise_vehicles_sale_manager_not_self
      CHECK (sale_manager_by IS NULL OR sale_submitted_by IS NULL OR sale_manager_by <> sale_submitted_by);
  END IF;
END $$;
