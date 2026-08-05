import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectCallLogsTable() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const [callLogsSample, kiaCallLogsSample] = await Promise.all([
    sql`SELECT * FROM call_logs LIMIT 10`,
    sql`SELECT * FROM kia_call_logs LIMIT 10`
  ])

  console.log('--- call_logs sample ---')
  console.log(callLogsSample)

  console.log('\n--- kia_call_logs sample ---')
  console.log(kiaCallLogsSample)

  // Get total count of call_logs and breakdown
  const callLogsCount = await sql`SELECT COUNT(*) FROM call_logs`
  console.log('\nTotal call_logs count:', callLogsCount[0]?.count)

  const callLogsTypes = await sql`
    SELECT call_type, COUNT(*) 
    FROM call_logs 
    GROUP BY call_type
  `
  console.log('call_logs types breakdown:', callLogsTypes)

  await sql.end()
}

inspectCallLogsTable().catch(console.error)
