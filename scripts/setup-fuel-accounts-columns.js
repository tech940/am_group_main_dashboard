const postgres = require('postgres')
require('dotenv').config()

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured')
  }

  const sql = postgres(databaseUrl, {
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    max: 1,
    prepare: false,
  })

  try {
    console.log('[fuel-approvals] Ensuring accounts approval columns exist...')
    await sql.unsafe(`
      ALTER TABLE fuel_approvals 
      ADD COLUMN IF NOT EXISTS accounts_approved_by uuid REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS accounts_approved_by_name text,
      ADD COLUMN IF NOT EXISTS accounts_approved_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS accounts_remarks text;
    `)

    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'fuel_approvals' 
      AND column_name LIKE 'accounts%'
    `
    console.log('[fuel-approvals] Accounts columns:', cols)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('[fuel-approvals] Error applying columns:', err)
  process.exit(1)
})
