/**
 * What makes two enquiry rows THE SAME ENQUIRY.
 *
 * The Hyundai-family DMS feeds (`hyundai_enquiry_report`, `am_platinum_enquiry_report`) ship the
 * same enquiry many times over. Counting rows therefore counts uploads, not enquiries:
 *
 *   hyundai_enquiry_report   last 12 months   28,366 rows  ->  17,374 enquiries   (-38.8%)
 *   hyundai_enquiry_report   last full month   3,091 rows  ->   2,143 enquiries   (-30.7%)
 *   am_platinum_enquiry_report  last 12 months 14,604 rows -> 14,525 enquiries    (-0.5%)
 *
 * ⚠️ `row_hash` CANNOT be used to dedupe these feeds. It is distinct on 100% of rows in both tables
 * (226,110/226,110 and 39,810/39,810) because our own ingest trigger makes every row unique, so the
 * built-in duplicate check is dead code. Nothing about a re-upload is detectable from it.
 *
 * ── Why this key ──────────────────────────────────────────────────────────────────────────────
 * `customer_id` is the DMS's OWN customer key and is populated on every row in both tables. Paired
 * with the enquiry date and the model enquired about, it identifies one enquiry.
 *
 * Rejected alternatives, all measured:
 *   - `s_no`         — only 2,593 distinct values across 226,110 rows. It is a line number within
 *                      each export file, not an identity.
 *   - `order_ref_no` — blank on 223,553 of 226,110 rows.
 *   - `row_hash`     — dead, see above.
 *   - phone + date + model — nearly identical on the windows the report shows (17,413 vs 17,374
 *                      over 12 months) but it MERGES DISTINCT PEOPLE: 1,175 duplicate groups hold
 *                      more than one customer_id AND more than one name, i.e. family members
 *                      sharing a handset. Under-counting real enquiries is the worse error, because
 *                      it silently flatters every conversion rate computed against it.
 *
 * Model is part of the key on purpose. A customer enquiring about a Creta and a Venue on the same
 * day made TWO enquiries, and 2,387 such pairs exist in the Hyundai feed.
 *
 * A row with no customer_id falls back to its own primary key, so it stays distinct rather than
 * collapsing every id-less row into one. That is the conservative direction: such a row is counted
 * exactly as it was before this change.
 */
export const ENQUIRY_IDENTITY_SQL =
  "(COALESCE(NULLIF(BTRIM(customer_id::text), ''), 'row:' || id::text)" +
  " || '|' || COALESCE(enquiry_date::text, '')" +
  " || '|' || UPPER(BTRIM(COALESCE(model::text, ''))))"

/**
 * The same expression qualified by a table alias, for queries that alias the enquiry table.
 *
 * @param alias e.g. 'e' -> `(COALESCE(NULLIF(BTRIM(e.customer_id::text), ''), ...)`
 */
export function enquiryIdentitySql(alias: string): string {
  return ENQUIRY_IDENTITY_SQL.replace(/\b(customer_id|enquiry_date|model|id)\b/g, `${alias}.$1`)
}
