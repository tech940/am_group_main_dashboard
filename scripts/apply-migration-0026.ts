import 'dotenv/config'
import postgres from 'postgres'

async function run() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Running migration 0026: Add md_user_id to delegation_tasks...')
    await sql.unsafe(`
      ALTER TABLE delegation_tasks ADD COLUMN IF NOT EXISTS md_user_id uuid REFERENCES users(id);
      CREATE INDEX IF NOT EXISTS delegation_tasks_md_idx ON delegation_tasks(md_user_id, status);
    `)
    console.log('Migration 0026 completed successfully.')
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
