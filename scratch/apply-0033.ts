import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

/** Applies migration 0033 (three CREATE INDEX IF NOT EXISTS statements — idempotent). */
async function main() {
  const text = readFileSync('lib/db/migrations/0033_add_kia_retail_review_indexes.sql', 'utf8')
  // Strip comment lines BEFORE splitting on ';' so a semicolon inside a comment cannot split a
  // statement in half.
  const statements = text
    .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)
  for (const statement of statements) {
    const started = Date.now()
    await db.execute(sql.raw(statement))
    console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s): ${statement.slice(0, 80).replace(/\s+/g, ' ')}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
