import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const before = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'role' order by e.enumsortorder`
    const had = before.some((r) => r.enumlabel === 'h_promise_head')
    console.log(`Before: role has ${before.length} values; h_promise_head present = ${had}`)

    if (!had) {
      await sql.unsafe(`ALTER TYPE role ADD VALUE IF NOT EXISTS 'h_promise_head'`)
      console.log('Applied: ALTER TYPE role ADD VALUE h_promise_head')
    } else {
      console.log('Skipped: value already present.')
    }

    const after = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'role' order by e.enumsortorder`
    const present = after.some((r) => r.enumlabel === 'h_promise_head')
    console.log(`After: h_promise_head present = ${present}`)
    process.exit(present ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Migration 0077 failed:', error)
  process.exit(1)
})
