import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql.unsafe(`
      ALTER TABLE public.kia_walk_in_leads
        ADD COLUMN IF NOT EXISTS alternate_mobile text;
    `)
    console.log('Applied migration 0078: alternate_mobile column added to kia_walk_in_leads.')

    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'kia_walk_in_leads' AND column_name = 'alternate_mobile'
    `
    console.log('Column check:', cols)
    process.exit(cols.length > 0 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Migration 0078 failed:', error)
  process.exit(1)
})
