import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectCallRecordingsClassification() {
  const supabase = getCreSupabase()
  
  const { data: recs, error } = await supabase
    .from('call_recordings')
    .select('id, cre_id, call_type, duration_seconds, phone, contact_name, recorded_at')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Total call_recordings rows in DB:', recs.length)

  // Fetch profiles
  const { data: profiles } = await supabase.from('user_profiles').select('id, full_name')
  const profileMap = new Map((profiles || []).map(p => [p.id, p.full_name]))

  // Group by CRE
  const creSummary: Record<string, { total: number; durationGt0: number; durationEq0: number; callTypes: Record<string, number> }> = {}

  for (const r of recs) {
    const creName = profileMap.get(r.cre_id) || r.cre_id || 'Unknown'
    if (!creSummary[creName]) {
      creSummary[creName] = { total: 0, durationGt0: 0, durationEq0: 0, callTypes: {} }
    }
    const stat = creSummary[creName]
    stat.total += 1
    const dur = Number(r.duration_seconds) || 0
    if (dur > 0) stat.durationGt0 += 1
    else stat.durationEq0 += 1
    stat.callTypes[r.call_type || 'null'] = (stat.callTypes[r.call_type || 'null'] || 0) + 1
  }

  console.log('CRE Summary from call_recordings:', JSON.stringify(creSummary, null, 2))
}

inspectCallRecordingsClassification().catch(console.error)
