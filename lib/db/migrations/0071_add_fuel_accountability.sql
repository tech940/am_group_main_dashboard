-- 0071 — Requested vs approved vs actual fuel, the gate-pass link, and a review log for fuel exceptions.
--
-- ⚠️ APPLY BY HAND ON THE DIRECT/SESSION PORT 5432. DDL must not run on the pgbouncer pooler (6543).
-- ⚠️ Requires 0051 (demo_gate_passes), 0063 and 0064.
--
-- ── Why this exists (owner decisions, 2026-09-16) ───────────────────────────────────────────
-- 0063 said "fuel_filled_ltrs IS the quantity" and forbade a second quantity column. The owner reversed that
-- for the Fuel Management redesign: a fuel request now carries THREE different facts, recorded by three
-- different people at three different moments. They are not copies of one number:
--
--   fuel_filled_ltrs   REQUESTED — typed by the requester. Unchanged; never renamed.
--   approved_quantity  APPROVED  — set by the approver at approval, defaulting to the requested figure.
--   actual_quantity    ACTUAL    — recorded from the bill when the order is closed, or read off the pump
--                                  meter of the linked "Fuel filling" gate pass.
--
-- A demo car's "Fuel filling" gate pass is linked by the requester PICKING it on the request (never
-- auto-matched): gate_pass_id. One pass can back at most one request.
--
-- department is the department the fuel is FOR. The requester's own department says nothing about usage —
-- measured on 2026-09-16, 37 of 44 requests were raised by Human Resources. NULL means "not recorded".
--
-- fuel_exception_reviews: a person looked at an exception and said what it was. Append-only; the latest row
-- per exception_key is its current review. The exceptions themselves are COMPUTED, never stored — storing
-- them would be a second copy of what the fuel records already say.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. The three quantities, the gate pass and the using department.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_approvals
  ADD COLUMN IF NOT EXISTS approved_quantity numeric(10,2),
  ADD COLUMN IF NOT EXISTS actual_quantity   numeric(10,2),
  ADD COLUMN IF NOT EXISTS gate_pass_id      uuid,
  ADD COLUMN IF NOT EXISTS department        text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_approvals_approved_quantity_positive') THEN
    ALTER TABLE public.fuel_approvals
      ADD CONSTRAINT fuel_approvals_approved_quantity_positive CHECK (approved_quantity IS NULL OR approved_quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_approvals_actual_quantity_positive') THEN
    ALTER TABLE public.fuel_approvals
      ADD CONSTRAINT fuel_approvals_actual_quantity_positive CHECK (actual_quantity IS NULL OR actual_quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_approvals_gate_pass_id_fkey') THEN
    -- SET NULL: a deleted pass must not take the fuel record with it.
    ALTER TABLE public.fuel_approvals
      ADD CONSTRAINT fuel_approvals_gate_pass_id_fkey
      FOREIGN KEY (gate_pass_id) REFERENCES public.demo_gate_passes (id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- One pass backs at most one request, or the same pump litres would be counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS fuel_approvals_gate_pass_id_key
  ON public.fuel_approvals (gate_pass_id) WHERE gate_pass_id IS NOT NULL;

-- Fuel Management filters every read by the fill date.
CREATE INDEX IF NOT EXISTS fuel_approvals_fill_date_idx
  ON public.fuel_approvals (fuel_filled_date DESC, created_at DESC);

-- The 41 requests approved before this column existed were approved exactly as requested: the approve
-- action had no way to change the quantity. So their approved quantity IS the requested one — a fact, not
-- an estimate. Actual quantity is NOT backfilled: nobody recorded it, and a guess would look measured.
UPDATE public.fuel_approvals
   SET approved_quantity = fuel_filled_ltrs
 WHERE status = 'approved'
   AND approved_quantity IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Exception reviews — append-only.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_exception_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The computed exception's stable key, e.g. 'actual_over_approved:<fuel_approvals.id>'.
  exception_key    text NOT NULL,
  kind             text NOT NULL,
  -- ⚠️ Deliberately NO foreign key. ON DELETE SET NULL is an UPDATE, which the append-only trigger below
  -- refuses, so an FK would make any reviewed fuel record impossible to delete. subject_label keeps the row readable.
  fuel_approval_id uuid,
  -- The VIN, asset code or vehicle label the exception is about, so the row still reads without the join.
  subject_label    text,
  -- What the reviewer concluded. Neutral on purpose: an exception is a prompt to look, not a finding.
  outcome          text NOT NULL CHECK (outcome IN ('explained', 'data_error', 'follow_up')),
  note             text NOT NULL CHECK (length(btrim(note)) > 0),
  actor_id         uuid REFERENCES public.users (id),
  actor_name       text NOT NULL,
  actor_role       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fuel_exception_reviews_key_idx
  ON public.fuel_exception_reviews (exception_key, created_at DESC);

CREATE OR REPLACE FUNCTION public.fuel_exception_reviews_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'fuel_exception_reviews is append-only (% refused)', TG_OP;
END;
$$;

CREATE OR REPLACE TRIGGER fuel_exception_reviews_append_only
  BEFORE UPDATE OR DELETE ON public.fuel_exception_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fuel_exception_reviews_append_only();

CREATE OR REPLACE TRIGGER fuel_exception_reviews_no_truncate
  BEFORE TRUNCATE ON public.fuel_exception_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.fuel_exception_reviews_append_only();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- RLS lockdown, as 0064. The app connects as `postgres` (owner, BYPASSRLS) and is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_exception_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fuel_exception_reviews FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.fuel_exception_reviews TO service_role;

COMMIT;

-- Verification (run separately):
-- SELECT count(*) FILTER (WHERE approved_quantity IS NOT NULL), count(*) FILTER (WHERE status = 'approved')
--   FROM public.fuel_approvals;                                                    -- the two counts are equal
-- SELECT count(*) FROM public.fuel_approvals WHERE actual_quantity IS NOT NULL;    -- 0 straight after applying
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'fuel_exception_reviews';     -- true
-- SELECT grantee FROM information_schema.role_table_grants
--  WHERE table_name = 'fuel_exception_reviews' AND grantee IN ('anon','authenticated','PUBLIC');  -- ZERO rows
