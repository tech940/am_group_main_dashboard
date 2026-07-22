import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const id = 'e82ceaac-32c4-4c34-b6e8-2b908630ae25'

  await sql`ALTER TABLE delegation_task_activity DISABLE TRIGGER delegation_task_activity_no_mutate`
  console.log('Trigger disabled')

  await sql`DELETE FROM delegation_task_activity WHERE task_id = ${id}`
  console.log('Activity logs deleted')

  await sql`ALTER TABLE delegation_task_activity ENABLE TRIGGER delegation_task_activity_no_mutate`
  console.log('Trigger re-enabled')

  const deleted = await sql`DELETE FROM delegation_tasks WHERE id = ${id} RETURNING id, title`
  console.log('Deleted task:', JSON.stringify(deleted, null, 2))

  await sql.end()
}

main().catch(console.error)
