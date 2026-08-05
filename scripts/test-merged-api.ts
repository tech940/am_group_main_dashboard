import postgres from 'postgres'
import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

const DATABASE_URL = process.env.DATABASE_URL!

async function testMergedApiData() {
  const sql = postgres(DATABASE_URL, { max: 1 })
  const supabase = getCreSupabase()

  const [callyzerRows, supabaseRes] = await Promise.all([
    sql`
      SELECT id, client_number, client_name, emp_name, emp_number, call_type, duration, call_date, call_time
      FROM callyzer_calls
      WHERE call_date >= '2026-07-06'
      ORDER BY call_date DESC, call_time DESC
    `,
    supabase.from('call_recordings').select('*')
  ])

  console.log('Callyzer calls fetched:', callyzerRows.length)
  console.log('Supabase recordings fetched:', supabaseRes.data?.length)

  let missedIncoming = 0
  let missedOutgoing = 0
  let connectedIncoming = 0
  let connectedOutgoing = 0

  for (const c of callyzerRows) {
    const type = (c.call_type || '').toLowerCase()
    const dur = Number(c.duration) || 0

    if (type === 'missed' || (type === 'incoming' && dur === 0)) {
      missedIncoming++
    } else if (type === 'rejected' || (type === 'outgoing' && dur === 0)) {
      missedOutgoing++
    } else if (type === 'incoming' && dur > 0) {
      connectedIncoming++
    } else if (type === 'outgoing' && dur > 0) {
      connectedOutgoing++
    }
  }

  console.log('\nMerged Call Summary:')
  console.log('Total Calls:', callyzerRows.length)
  console.log('Connected Outgoing:', connectedOutgoing)
  console.log('Connected Incoming:', connectedIncoming)
  console.log('Missed Incoming:', missedIncoming)
  console.log('Not Answered Outgoing:', missedOutgoing)
  console.log('Total Unanswered:', missedIncoming + missedOutgoing)

  await sql.end()
}

testMergedApiData().catch(console.error)
