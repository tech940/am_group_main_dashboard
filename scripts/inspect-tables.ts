import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectTables() {
  const supabase = getCreSupabase()
  
  // Try querying callyzer or call_logs or cre tables
  const results = await Promise.allSettled([
    supabase.from('call_recordings').select('id', { count: 'exact', head: true }),
    supabase.from('callyzer_call_summary').select('*', { count: 'exact', head: true }),
    supabase.from('call_logs').select('*', { count: 'exact', head: true }),
    supabase.from('v_cre_performance').select('*'),
  ])

  results.forEach((res, idx) => {
    console.log(`Query ${idx}:`, res.status === 'fulfilled' ? res.value : res.reason)
  })
}

inspectTables().catch(console.error)
