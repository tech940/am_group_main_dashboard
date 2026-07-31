/**
 * Restores `scrap_transactions` from a backup written by scripts/import-overall-scrap-xlsx.ts.
 *
 *   npx tsx scripts/restore-scrap-backup.ts --file scripts/backups/scrap_transactions_<stamp>.json
 *   npx tsx scripts/restore-scrap-backup.ts --file <path> --apply
 *
 * Default is a DRY RUN. `--apply` replaces the table contents with the backup, in one transaction.
 *
 * The backup is a verbatim `SELECT *`, so it carries all 38 live columns — including the ones
 * lib/db/schema.ts does not know about. Columns are taken from the file itself rather than a
 * hardcoded list, so a restore stays correct even if the table gains columns later.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const argv = process.argv.slice(2)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const APPLY = argv.includes('--apply')
const FILE = opt('file')

async function main() {
  if (!FILE) throw new Error('pass --file <backup.json>')
  const rows = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>[]
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('backup is empty or not an array')

  const columns = Object.keys(rows[0])
  console.log(`BACKUP  ${rows.length} row(s), ${columns.length} column(s)`)
  console.log(`MODE    ${APPLY ? 'APPLY (destructive)' : 'DRY RUN (no writes)'}`)

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })

  try {
    const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*)::int n FROM scrap_transactions`
    console.log(`LIVE    ${n} row(s) would be replaced by ${rows.length}`)
    if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return }

    await sql.begin(async (tx) => {
      const deleted = await tx`DELETE FROM scrap_transactions RETURNING 1`
      console.log(`DELETE  ${deleted.length} row(s)`)
      for (let i = 0; i < rows.length; i += 100) {
        await tx`INSERT INTO scrap_transactions ${tx(rows.slice(i, i + 100), ...columns)}`
      }
      console.log(`INSERT  ${rows.length} row(s)`)
    })

    const [after] = await sql<{ n: number }[]>`SELECT COUNT(*)::int n FROM scrap_transactions`
    console.log(`\nRESTORED — table now holds ${after.n} row(s)`)
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('\nRESTORE FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
