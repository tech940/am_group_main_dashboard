import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    const result = await db.execute(sql`
      SELECT 
        event_object_table AS table_name,
        trigger_name,
        event_manipulation AS event,
        action_statement AS action,
        action_timing AS timing
      FROM information_schema.triggers
      ORDER BY table_name, trigger_name
    `)
    console.log('All Triggers in database:', result)
  } catch (error) {
    console.error('Error querying triggers:', error)
  } finally {
    process.exit(0)
  }
}

main()
