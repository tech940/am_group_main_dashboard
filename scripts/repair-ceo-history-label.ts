/**
 * Repair history entries recorded as `{ role: 'MD', roleKey: 'ceo' }`.
 *
 * ⚠️ WHY THESE EXIST: `app/api/brands/kia/approvals/[id]/action/route.ts` built its history label
 * from a chain of ternaries with NO 'ceo' branch, so every CEO action fell through to the trailing
 * `: 'MD'`. The stage key was right; only the human-readable label was wrong. The workflow strip
 * then matched stages by that label and rendered the CEO's name and time under MD APPROVAL.
 *
 * This corrects the LABEL ONLY. No roleKey, user, action, remark or timestamp is touched, and no
 * approval decision changes — `jsonb_set` on the single `role` field, with array order preserved by
 * `WITH ORDINALITY`. The value goes in via `to_jsonb(text)`, never `JSON.stringify(...)::jsonb`,
 * which double-encodes and has already corrupted this column once.
 *
 *   npx tsx scripts/repair-ceo-history-label.ts          # dry run
 *   npx tsx scripts/repair-ceo-history-label.ts --apply
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 })

async function main() {
  const affected = await sql<any[]>`
    SELECT r.request_no, r.brand, h->>'user' AS actor, h->>'role' AS bad_label, h->>'timestamp' AS ts
    FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
    WHERE jsonb_typeof(r.history) = 'array'
      AND h->>'roleKey' = 'ceo' AND h->>'role' IS DISTINCT FROM 'CEO'
    ORDER BY r.created_at DESC`

  console.log(`${affected.length} mislabelled CEO history entries:\n`)
  for (const a of affected) {
    console.log(`  ${String(a.request_no).padEnd(10)} ${String(a.brand).padEnd(9)} ${String(a.actor).padEnd(20)} role "${a.bad_label}" -> "CEO"   ${a.ts}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await sql.end()
    return
  }

  const updated = await sql<any[]>`
    UPDATE kia_approval_requests r
    SET history = (
      SELECT jsonb_agg(
        CASE WHEN e->>'roleKey' = 'ceo' AND e->>'role' IS DISTINCT FROM 'CEO'
             THEN jsonb_set(e, '{role}', to_jsonb('CEO'::text))
             ELSE e END
        ORDER BY ord)
      FROM jsonb_array_elements(r.history) WITH ORDINALITY AS t(e, ord))
    WHERE jsonb_typeof(r.history) = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.history) x
                  WHERE x->>'roleKey' = 'ceo' AND x->>'role' IS DISTINCT FROM 'CEO')
    RETURNING r.request_no`
  console.log(`\nUpdated ${updated.length} requests.`)

  const [{ remaining }] = await sql<any[]>`
    SELECT COUNT(*)::int AS remaining
    FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
    WHERE jsonb_typeof(r.history) = 'array'
      AND h->>'roleKey' = 'ceo' AND h->>'role' IS DISTINCT FROM 'CEO'`
  console.log(`Mislabelled entries remaining: ${remaining}`)

  // No entry may be double-encoded: role must be a jsonb string, not a string containing quotes.
  const [{ dbl }] = await sql<any[]>`
    SELECT COUNT(*)::int AS dbl
    FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
    WHERE jsonb_typeof(r.history) = 'array' AND h->>'role' LIKE '"%"'`
  console.log(`Double-encoded role values: ${dbl}`)
  await sql.end()
}
main().catch(async e => { console.error('FAILED:', e.message); await sql.end(); process.exit(1) })
