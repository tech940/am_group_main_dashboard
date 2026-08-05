import postgres from 'postgres'
import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

const DATABASE_URL = process.env.DATABASE_URL!

async function testCombinedFetch() {
  const sql = postgres(DATABASE_URL, { max: 1 })
  const supabase = getCreSupabase()

  const [recsRes, callyzerRows] = await Promise.all([
    supabase.from('call_recordings').select('*'),
    sql`
      SELECT id, client_number, client_name, emp_name, emp_number, call_type, duration, call_date, call_time
      FROM callyzer_calls
      WHERE call_date >= '2026-07-06'
      ORDER BY call_date DESC, call_time DESC
    `
  ])

  console.log('Supabase call_recordings count:', recsRes.data?.length)
  console.log('Postgres callyzer_calls count (last 30d):', callyzerRows.length)

  // Separate callyzer rows by missed/unanswered vs connected
  const callyzerMissedIncoming = callyzerRows.filter(c => c.call_type === 'Missed' || (c.call_type === 'Incoming' && Number(c.duration) === 0))
  const callyzerMissedOutgoing = callyzerRows.filter(c => c.call_type === 'Rejected' || (c.call_type === 'Outgoing' && Number(c.duration) === 0))
  const callyzerConnected = callyzerRows.filter(c => Number(c.duration) > 0)

  console.log('\n--- Callyzer breakdown (last 30d) ---')
  console.log('Missed Incoming:', callyzerMissedIncoming.length)
  console.log('Not Answered Outgoing:', callyzerMissedOutgoing.length)
  console.log('Connected Calls:', callyzerConnected.length)

  await sql.end()
}

testCombinedFetch().catch(console.error)
