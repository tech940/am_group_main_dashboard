-- Call Analysis matches caller numbers to known customers by normalising both sides to the last 10
-- digits. That normalisation is a function OF the column, so a plain index on contact_number cannot
-- serve it: every lookup seq-scanned kia_enquiry_report (66,995 rows / 52 MB) running a regexp per
-- row. Measured at 5,274 ms for a single 120-number page — 30x the cost of every other query on the
-- page combined.
--
-- regexp_replace(text,text,text,text) and right() are both IMMUTABLE, so the expression is indexable
-- verbatim. It must stay character-for-character identical to lib/callyzer/customer-match.ts or the
-- planner will not match it.
--
-- kia_bookings is deliberately left alone (72 rows — an index there would never be chosen).

CREATE INDEX IF NOT EXISTS idx_kia_enquiry_report_phone10
  ON kia_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10));

-- Supports the DISTINCT ON (...) ORDER BY phone10, enquiry_date DESC that picks the latest enquiry
-- per number.
CREATE INDEX IF NOT EXISTS idx_kia_enquiry_report_phone10_date
  ON kia_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10), enquiry_date DESC);

-- Same pair for Hyundai. 71% of the call log comes from the "AM HYUNDAI" handset, so matching only
-- KIA identified 4 of the top 120 callers; Hyundai's enquiry feed identifies 45 of the same 120.
CREATE INDEX IF NOT EXISTS idx_hyundai_enquiry_report_phone10
  ON hyundai_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_hyundai_enquiry_report_phone10_date
  ON hyundai_enquiry_report (RIGHT(regexp_replace(COALESCE(contact_number, ''), '\D', '', 'g'), 10), enquiry_date DESC);
