import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectCallRecordings() {
  const supabase = getCreSupabase()
  const { data, error } = await supabase.from('call_recordings').select('id, call_type, duration_seconds, upload_status, phone, cre_id, recorded_at').limit(100)
  
  if (error) {
    console.error('Error fetching call recordings:', error)
    return
  }

  console.log('Fetched sample rows count:', data.length)
  
  // Group by call_type and duration > 0 vs 0
  const summary: Record<string, number> = {}
  for (const row of data) {
    const dur = Number(row.duration_seconds) || 0
    const key = `type:${row.call_type} | dur:${dur > 0 ? '>0' : '0'}`
    summary[key] = (summary[key] || 0) + 1
  }

  console.log('Call breakdown sample:', summary)

  // Check unique call_type values
  const types = new Set(data.map(r => r.call_type))
  console.log('Unique call_type values:', Array.from(types))
}

inspectCallRecordings().catch(console.error)
