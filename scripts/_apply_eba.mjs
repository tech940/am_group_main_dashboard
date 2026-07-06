import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
const url = line.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
const sql = postgres(url, { prepare: false, max: 1 })

try {
  // additive, idempotent: adds 'eba' after 'md' to match the app schema ordering
  await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'eba' AFTER 'md'`)
  console.log("APPLIED: ALTER TYPE role ADD VALUE IF NOT EXISTS 'eba'")

  const rows = await sql`
    select e.enumlabel as label
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'role' order by e.enumsortorder`
  const dbRoles = rows.map(r => r.label)
  console.log('DB role enum now:', dbRoles.join(', '))
  console.log("Contains 'eba':", dbRoles.includes('eba'))
} catch (e) {
  console.log('ERROR:', e.code, e.message)
} finally {
  await sql.end()
}
