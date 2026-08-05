import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function findCreLogsInSupabase() {
  const supabase = getCreSupabase()

  // List all tables/views in Supabase by querying user_profiles, branch_directory, call_recordings, v_cre_performance, or RPC
  const [profiles, branches, perf] = await Promise.all([
    supabase.from('user_profiles').select('*'),
    supabase.from('branch_directory').select('*'),
    supabase.from('v_cre_performance').select('*'),
  ])

  console.log('--- user_profiles ---')
  console.log(profiles.data)

  console.log('--- v_cre_performance ---')
  console.log(perf.data)

  // Test if there are other tables like call_logs, cre_call_logs, cre_calls, etc.
  const tablesToTry = ['call_logs', 'cre_call_logs', 'cre_calls', 'call_history', 'handset_logs', 'call_attempts']
  for (const t of tablesToTry) {
    const res = await supabase.from(t).select('*', { count: 'exact', head: true })
    console.log(`Table '${t}': status=${res.status}, count=${res.count}, error=${res.error?.message}`)
  }
}

findCreLogsInSupabase().catch(console.error)
