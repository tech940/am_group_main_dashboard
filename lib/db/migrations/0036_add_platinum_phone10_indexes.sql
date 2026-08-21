-- Phone-number matching for AM Platinum, completing the pair added for KIA and Hyundai in 0026.
--
-- Call Analysis resolves a caller to a customer by normalising both sides to the last 10 digits.
-- That normalisation is a function OF the column, so a plain index on contact_number cannot serve
-- it. KIA and Hyundai got functional indexes in migration 0026; am_platinum_enquiry_report never
-- did, because nothing in the codebase read that table until the CRE call section started matching
-- against it. It contributes 47-140 identities per full call log (more when Platinum is the CRE's
-- own brand), so it is now on the hot path.
--
-- ⚠️ The expression must stay CHARACTER-FOR-CHARACTER identical to the one in
-- lib/customer-identity/phone-match.ts and to the 0026 indexes, or the planner silently ignores it
-- and every lookup seq-scans the table. `right()` and `regexp_replace(text,text,text,text)` are both
-- IMMUTABLE, so the expression is indexable verbatim.
--
-- ⚠️ TABLE NAME: it is `am_platinum_enquiry_report`. It was RENAMED from
-- `am_platinum_hyundai_enquiry_report`, which survives only as the names of its primary key and
-- sequence — so the obvious name is the wrong one and fails at runtime, not at compile time.
--
-- Cost note, so this is not mistaken for an emergency: at real page scale (a few dozen numbers) the
-- un-indexed seq scan over ~39,800 rows measures ~33 ms. This is worth having for consistency and
-- for the whole-log lookups, not because the page is currently slow.
--
-- Migrations in this repo are applied BY HAND. Run `npm run db:backup` first. DDL cannot run through
-- the pgbouncer transaction pooler — use the direct/session port (see scripts/create-discounts-table.ts).

CREATE INDEX IF NOT EXISTS idx_am_platinum_enquiry_report_phone10
  ON am_platinum_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10));

-- Supports the ORDER BY phone10, enquiry_date DESC that picks the most recent enquiry per number.
CREATE INDEX IF NOT EXISTS idx_am_platinum_enquiry_report_phone10_date
  ON am_platinum_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10), enquiry_date DESC);

-- The planner needs statistics on the EXPRESSION, not just the column, to choose these. Without a
-- fresh ANALYZE the same query has been observed alternating between an index scan (0.7 ms) and a
-- seq scan (90 ms) on the already-indexed KIA table, so do not skip this.
ANALYZE am_platinum_enquiry_report;
