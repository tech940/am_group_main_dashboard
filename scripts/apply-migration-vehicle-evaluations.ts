import 'dotenv/config'
import postgres from 'postgres'
import fs from 'node:fs'
import path from 'node:path'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('DATABASE_URL is not set. Skipping DB migration run.')
    return
  }

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const migrationSql = fs.readFileSync(
      path.join(process.cwd(), 'lib/db/migrations/0077_add_vehicle_evaluations.sql'),
      'utf-8',
    )
    console.log('Running vehicle_evaluations table migration...')
    await sql.unsafe(migrationSql)
    console.log('Successfully created/verified public.vehicle_evaluations table!')
  } catch (err) {
    console.error('Migration error:', err)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
})
