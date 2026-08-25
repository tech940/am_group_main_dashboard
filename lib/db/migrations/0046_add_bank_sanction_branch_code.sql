-- Bank Sanctions: scope each facility to a brand, so a KIA/Hyundai/Platinum login sees only its own
-- borrowing position. MD and Developer keep the whole group view.
--
-- ── Why a new column rather than parsing `location` ───────────────────────────────────────────
-- `location` is a free-text ENTITY name inherited from the Google Sheet ("SMAM AUTO", "AMG AUTOCRAFT
-- PVT LTD(BARBARSHAH)"), not a brand. Nothing in the string reliably says which dealership owns the
-- facility — "Platinum Auto" is the plainest example: it reads as Platinum but its expiry alerts go
-- to accounts@amhyundai.com. Inferring a brand from that text would be a guess re-evaluated on every
-- read, and a wrong guess exposes one dealership's bank position to another. So the brand is stored
-- explicitly, seeded once below from evidence + a business decision, and editable in the UI
-- afterwards without a code change.
--
-- ── NULL means GROUP-LEVEL, and that is a deliberate, restrictive default ─────────────────────
-- NULL = holding-company borrowing, visible to MD and Developer ONLY — not to a brand user, and not
-- even to a login assigned 'all'. Five locations sit here by explicit decision (2026-08-24), led by
-- Jammu Auto Mart, which is the single largest position in the register at Rs59.86 Cr.
-- The column is therefore nullable BY DESIGN; a NOT NULL default would have forced every unclassified
-- facility into somebody's view.
--
-- Migrations here are applied BY HAND on the direct/session port (never the pgbouncer pooler).

ALTER TABLE bank_sanction_limits
  ADD COLUMN IF NOT EXISTS branch_code text;

COMMENT ON COLUMN bank_sanction_limits.branch_code IS
  'Brand that owns this facility (kia/hyundai/platinum/tata/honda/mg/bajaj/ktm/triumph). NULL = group-level, MD & Developer only.';

-- ── Seed from the alert-email evidence + the 2026-08-24 business decisions ────────────────────
-- Matched on the SAME normalised key the UI groups by (lower-cased, non-alphanumerics stripped), so
-- the two spellings of Jammu Auto Mart — "Jammu Auto Mart" and "Jammuautomart" — are both caught.
-- Only rows still unset are touched, so re-running never overwrites a later manual correction.
UPDATE bank_sanction_limits SET branch_code = v.brand
FROM (VALUES
  -- location key                brand        evidence
  ('kia',              'kia'),      -- accounts@amkia.in
  ('honda',            'honda'),    -- diamondhondajmu@gmail.com
  ('smamauto',         'tata'),     -- accounts@amtata.net
  ('bajaj',            'bajaj'),    -- accounts@ambajaj.com
  ('amgautocraftpvtltd','mg'),      -- jammu.accounts2@mgdealer.co.in
  ('ktm',              'ktm'),      -- kashmirautoaidspvtltd230313@gmail.com
  ('truimph',          'triumph'),  -- same entity inbox as KTM; sheet spells it "TRUIMPH"
  ('platinumauto',     'platinum')  -- named Platinum; alerts go to Hyundai accounts. Business call
                                    -- 2026-08-24: scope it to PLATINUM.
) AS v(loc_key, brand)
WHERE lower(regexp_replace(btrim(bank_sanction_limits.location), '[^a-zA-Z0-9]', '', 'g')) = v.loc_key
  AND bank_sanction_limits.branch_code IS NULL;

-- Left NULL on purpose (group-level, MD/Developer only), by explicit decision:
--   Jammu Auto Mart · SMAM INDIA RETAIL PVT LTD · SMAM INDIA RETAIL PVT LTD (ANANTNAG)
--   AMSM AUTOMART PVT LTD(HYDERPURA) · AMG AUTOMART PVT LTD(BARBARSHAH)

CREATE INDEX IF NOT EXISTS bank_sanction_limits_branch_code_idx
  ON bank_sanction_limits (branch_code);

ANALYZE bank_sanction_limits;

-- Verify — expect the 8 brand-mapped groups and 5 group-level locations.
-- SELECT COALESCE(branch_code, '(group-level)') AS branch,
--        COUNT(*)::int AS facilities,
--        ROUND(SUM(credit_limit::numeric)/1e7, 2) AS limit_cr
-- FROM bank_sanction_limits GROUP BY 1 ORDER BY facilities DESC;
