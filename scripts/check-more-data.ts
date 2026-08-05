import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function checkMoreData() {
  const supabase = getCreSupabase()

  const [perf, recs, profiles] = await Promise.all([
    supabase.from('v_cre_performance').select('*'),
    supabase.from('call_recordings').select('*'),
    supabase.from('user_profiles').select('*')
  ])

  console.log('--- v_cre_performance ---')
  console.log(perf.data)

  console.log('\n--- call_recordings total count ---')
  console.log(recs.data?.length)

  // Distinct call_type values in all recordings
  const typesCount: Record<string, number> = {}
  recs.data?.forEach((r: any) => {
    const key = `${r.call_type} (dur: ${r.duration_seconds > 0 ? '>0' : '0'})`
    typesCount[key] = (typesCount[key] || 0) + 1
  })
  console.log('All call_recordings breakdown:', typesCount)
}

checkMoreData().catch(console.error)
