import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('Disabling immutable trigger on delegation_task_activity...')
  await db.execute(sql`ALTER TABLE delegation_task_activity DISABLE TRIGGER delegation_task_activity_no_mutate`)

  try {
    console.log('Clearing delegation_task_activity logs...')
    const actResult = await db.execute(sql`DELETE FROM delegation_task_activity`)
    console.log('Activity logs cleared:', actResult)

    console.log('Clearing delegation_tasks table...')
    const taskResult = await db.execute(sql`DELETE FROM delegation_tasks`)
    console.log('Delegation tasks cleared:', taskResult)
    
    console.log('Delegation test data cleared successfully!')
  } catch (error) {
    console.error('Failed to clear data:', error)
  } finally {
    console.log('Re-enabling immutable trigger on delegation_task_activity...')
    await db.execute(sql`ALTER TABLE delegation_task_activity ENABLE TRIGGER delegation_task_activity_no_mutate`)
    console.log('Trigger re-enabled.')
  }
}

main()
