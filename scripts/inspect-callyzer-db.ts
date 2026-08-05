import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectCallyzerCalls() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const sample = await sql`
    SELECT id, emp_name, emp_number, call_type, duration, call_date, client_number
    FROM callyzer_calls
    ORDER BY call_date DESC
    LIMIT 10
  `
  console.log('--- callyzer_calls sample ---')
  console.log(sample)

  const summary = await sql`
    SELECT 
      emp_name,
      COUNT(*) as total_calls,
      COUNT(*) FILTER (WHERE call_type = 'Incoming' AND duration > 0) as connected_incoming,
      COUNT(*) FILTER (WHERE call_type = 'Outgoing' AND duration > 0) as connected_outgoing,
      COUNT(*) FILTER (WHERE call_type = 'Missed' OR (call_type = 'Incoming' AND duration = 0)) as missed_incoming,
      COUNT(*) FILTER (WHERE call_type = 'Rejected' OR call_type = 'Never Connected' OR (call_type = 'Outgoing' AND duration = 0)) as missed_outgoing
    FROM callyzer_calls
    GROUP BY emp_name
    ORDER BY total_calls DESC
    LIMIT 20
  `
  console.log('\n--- callyzer_calls summary by emp_name ---')
  console.table(summary)

  await sql.end()
}

inspectCallyzerCalls().catch(console.error)
