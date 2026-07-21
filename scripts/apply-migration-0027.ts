import 'dotenv/config'
import postgres from 'postgres'

async function run() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Running migration 0027: Set default priority to high and update existing tasks...')
    await sql.unsafe(`
      ALTER TABLE delegation_tasks ALTER COLUMN priority SET DEFAULT 'high';
      UPDATE delegation_tasks SET priority = 'high';
    `)
    console.log('Migration 0027 completed successfully.')
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
