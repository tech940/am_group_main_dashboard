import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectUnknownCalls() {
  const supabase = getCreSupabase()
  const { data, error } = await supabase
    .from('call_recordings')
    .select('*')
    .eq('call_type', 'unknown')

  if (error) {
    console.error(error)
    return
  }

  console.log('Unknown call_type count:', data.length)
  console.log('Sample unknown rows:', data.slice(0, 10))
}

inspectUnknownCalls().catch(console.error)
