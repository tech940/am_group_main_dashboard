-- Bank Sanction Limits — a port of the "Bank Sanction Limit System" Google Apps Script + Sheet
-- into the dashboard, as the /bank-sanctions section (EA / MD / Accounts / Developer only).
--
-- ── What the sheet did, and what this keeps ───────────────────────────────────────────────────
-- One row per credit facility (a "loan type" — CC/OD/TL accounts, often named with the account
-- number embedded), with location, limit, instalment, ROI, interest, outstanding, four milestone
-- dates, four free-text security fields, two attached PDFs and an alert email. Every save appended
-- a full snapshot to a second sheet ("Form Responses 1") as history, and a 15-day Apps Script
-- trigger emailed each alert address its expiring rows.
--
-- All of that behaviour is preserved. What the port deliberately FIXES:
--   * The sheet's delete gate was a password hardcoded in client-side JS (visible to anyone who
--     pressed View Source). Here access is role-gated server-side.
--   * A deleted sheet row was gone entirely; here a final snapshot lands in history first.
--   * Sheet dates were dd/mm/yyyy text; here they are real DATE columns.
--   * The sheet's editor could never CLEAR a field (empty meant "keep old"); here clearing is
--     an explicit, deliberate operation.
--
-- ── The duplicate rule, preserved exactly ─────────────────────────────────────────────────────
-- The sheet deduplicated loan types by the LAST NUMBER in the name — so "CC A/c 4501" and
-- "OD 4501" are the SAME facility (the account number is the identity; the wording drifts).
-- A name with no number deduplicates on its lower-cased text. The unique index below encodes that
-- rule in SQL: `substring(x from '([0-9]+)[^0-9]*$')` is POSIX leftmost-longest, so the greedy
-- prefix forces the LAST digit run — the exact JS `match(/\d+/g).pop()`.
--
-- Migrations here are applied BY HAND on the direct/session port (never the pgbouncer pooler).

-- ── 1. the register ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_sanction_limits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_type           text    NOT NULL,
  location            text    NOT NULL,
  credit_limit        numeric(16,2),
  instalment          numeric(16,2),
  -- Stored as a NUMBER. The sheet stored "12%" text and appended '%' in three separate places;
  -- the UI renders the suffix instead.
  roi_pct             numeric(7,3),
  interest_amount     numeric(16,2),
  outstanding_amount  numeric(16,2),
  date_of_sanction    date,
  installment_due_on  date,
  installment_paid_on date,
  expiry_date         date,
  guarantor           text,
  collateral          text,
  primary_security    text,
  corporate_guarantee text,
  document_url_1      text,
  document_url_2      text,
  -- Who receives this row in the 15-day expiry alert digest.
  alert_email         text,
  created_by          uuid REFERENCES users(id),
  updated_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sanction_limits_nonneg CHECK (
    COALESCE(credit_limit, 0) >= 0 AND COALESCE(instalment, 0) >= 0
    AND COALESCE(interest_amount, 0) >= 0 AND COALESCE(outstanding_amount, 0) >= 0
  )
);

-- The sheet's duplicate rule as a DB backstop (the app check produces the friendly message; this
-- makes it atomic and unbypassable — same division of labour as kia_bookings_same_day_unique_idx).
CREATE UNIQUE INDEX IF NOT EXISTS bank_sanction_limits_loan_key_idx
  ON bank_sanction_limits (
    COALESCE(substring(lower(btrim(loan_type)) FROM '([0-9]+)[^0-9]*$'), lower(btrim(loan_type)))
  );

CREATE INDEX IF NOT EXISTS bank_sanction_limits_location_idx
  ON bank_sanction_limits (location);
CREATE INDEX IF NOT EXISTS bank_sanction_limits_expiry_idx
  ON bank_sanction_limits (expiry_date);

-- ── 2. the audit trail ("Form Responses 1" equivalent) ───────────────────────────────────────
-- Append-only. One row per create / update / delete, carrying the FULL post-action snapshot as
-- jsonb, plus flat copies of the two identity columns so "history of this facility" is one indexed
-- read. record_id is SET NULL on delete so history outlives the record it describes.
CREATE TABLE IF NOT EXISTS bank_sanction_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id      uuid REFERENCES bank_sanction_limits(id) ON DELETE SET NULL,
  action         text NOT NULL, -- 'created' | 'updated' | 'deleted'
  loan_type      text NOT NULL,
  location       text NOT NULL,
  snapshot       jsonb NOT NULL,
  changed_by     uuid REFERENCES users(id),
  changed_by_email text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_sanction_history_record_idx
  ON bank_sanction_history (record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_sanction_history_loan_type_idx
  ON bank_sanction_history (lower(btrim(loan_type)), created_at DESC);

-- ── 3. lock away from the public anon key (same posture as 0038/0043) ─────────────────────────
ALTER TABLE IF EXISTS public.bank_sanction_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bank_sanction_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_sanction_limits  FROM anon;
REVOKE ALL ON public.bank_sanction_limits  FROM PUBLIC;
REVOKE ALL ON public.bank_sanction_history FROM anon;
REVOKE ALL ON public.bank_sanction_history FROM PUBLIC;
GRANT ALL ON public.bank_sanction_limits  TO service_role;
GRANT ALL ON public.bank_sanction_history TO service_role;

ANALYZE bank_sanction_limits;

-- Verify — expect 1,1,1,0.
-- SELECT
--   (to_regclass('public.bank_sanction_limits') IS NOT NULL)::int  AS limits_table,
--   (to_regclass('public.bank_sanction_history') IS NOT NULL)::int AS history_table,
--   (SELECT COUNT(*) FROM pg_indexes WHERE indexname='bank_sanction_limits_loan_key_idx')::int AS dup_idx,
--   (SELECT COUNT(*) FROM information_schema.role_table_grants
--     WHERE table_name='bank_sanction_limits' AND grantee='anon')::int AS anon_grants;
