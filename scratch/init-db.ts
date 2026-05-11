import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('Testing connection to:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@'))
  try {
    const result = await db.execute(sql`SELECT 1 as connected`)
    console.log('Connection successful:', result)
    
    console.log('Creating table manually...')
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "business_excellence_am_kia_new" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "brand" text NOT NULL,
        "sheet_name" text NOT NULL,
        "headers" jsonb NOT NULL,
        "rows" jsonb NOT NULL,
        "uploaded_at" timestamp DEFAULT now() NOT NULL
      );
    `)
    console.log('Table created successfully!')
  } catch (error: unknown) {
    const err = error as { message?: string; cause?: { message?: string } }
    console.error('FATAL DATABASE ERROR:', err.message || 'Unknown error')
    if (err.cause) console.error('CAUSE:', err.cause.message)
  } finally {
    process.exit(0)
  }
}

main()
