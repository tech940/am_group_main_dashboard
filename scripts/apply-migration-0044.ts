/**
 * Applies migration 0044 — the same-day duplicate guard on kia_bookings.
 *
 * Exists because `psql` is not installed on every machine here (the same gap
 * scripts/apply-migration-0043.ts works around). The `postgres` driver is already a dependency.
 *
 * ⚠️ DDL must NOT run through the Supabase transaction pooler (:6543). The URL is rewritten to the
 * session port below, mirroring lib/db/index.ts's own dev rewrite.
 *
 * Idempotent (CREATE ... IF NOT EXISTS), so re-running is safe. Reverse with
 * lib/db/migrations/0044_rollback_kia_duplicate_guards.sql.
 *
 * Run:  npx tsx scripts/apply-migration-0044.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

const MIGRATION = 'lib/db/migrations/0044_add_kia_duplicate_guards.sql'
const UNIQUE_IDX = 'kia_bookings_same_day_unique_idx'
const LOOKUP_IDX = 'kia_bookings_dup_lookup_idx'

function sessionModeUrl(raw: string): string {
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set. Is .env present?')

  const url = sessionModeUrl(raw)
  const parsed = new URL(url)
  const user = decodeURIComponent(parsed.username)
  const projectRef = user.includes('.') ? user.split('.').slice(1).join('.') : '(unknown)'
  console.log(`Target: ${parsed.hostname}:${parsed.port} db=${parsed.pathname.slice(1)} project=${projectRef}`)

  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })
  try {
    /*
     * A UNIQUE index cannot be built while a violating pair exists, and the failure message is not
     * obvious. Check FIRST so this script says exactly which rows are in the way rather than
     * surfacing a bare 23505 from CREATE INDEX.
     */
    const blockers = await sql`
      SELECT customer_phone,
             UPPER(BTRIM(model)) AS model,
             UPPER(BTRIM(COALESCE(variant, ''))) AS variant,
             (timezone('Asia/Kolkata', created_at))::date::text AS ist_day,
             COUNT(*)::int AS n
      FROM kia_bookings
      WHERE deleted_at IS NULL
      GROUP BY 1, 2, 3, 4
      HAVING COUNT(*) > 1`

    if (blockers.length > 0) {
      console.error(`\nCannot apply: ${blockers.length} same-day duplicate group(s) already exist.`)
      console.error('Resolve these (soft-delete the later row of each) and re-run:')
      for (const b of blockers) {
        console.error(`  ${b.customer_phone}  ${b.model} / ${b.variant}  on ${b.ist_day}  x${b.n}`)
      }
      process.exitCode = 1
      return
    }
    console.log('Pre-check: 0 same-day duplicate groups — the unique index can build.')

    const before = await sql`
      SELECT COUNT(*)::int AS n FROM pg_indexes
      WHERE tablename = 'kia_bookings' AND indexname IN (${UNIQUE_IDX}, ${LOOKUP_IDX})`
    console.log(`Before: ${before[0].n}/2 guard indexes present`)

    await sql.unsafe(fs.readFileSync(path.resolve(MIGRATION), 'utf8'))
    console.log('Applied 0044_add_kia_duplicate_guards.sql')

    const after = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'kia_bookings' AND indexname IN (${UNIQUE_IDX}, ${LOOKUP_IDX})
      ORDER BY indexname`

    for (const row of after) console.log(`        ${row.indexname}`)

    const unique = after.find((r) => r.indexname === UNIQUE_IDX)
    // Assert it is genuinely UNIQUE and genuinely partial — a plain index here would silently
    // enforce nothing, which is worse than not applying at all.
    const isUnique = Boolean(unique && /CREATE UNIQUE INDEX/i.test(String(unique.indexdef)))
    const isPartial = Boolean(unique && /WHERE \(deleted_at IS NULL\)/i.test(String(unique.indexdef)))

    console.log(`After : ${after.length}/2 present · unique=${isUnique} · partial=${isPartial}`)

    if (after.length !== 2 || !isUnique || !isPartial) {
      console.error('VERIFICATION FAILED — the indexes are not in the expected shape.')
      process.exitCode = 1
      return
    }
    console.log('\nVerified. A second identical booking on the same IST day is now impossible,')
    console.log('including through case or whitespace variance. Re-bookings on a later day still work.')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Migration 0044 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
