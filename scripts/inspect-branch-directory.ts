import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectBranchDirectory() {
  const supabase = getCreSupabase()
  const { data: branches, error } = await supabase.from('branch_directory').select('*')

  if (error) {
    console.error('Error fetching branches:', error)
    return
  }

  console.log('--- branch_directory in Supabase ---')
  console.log(branches)
}

inspectBranchDirectory().catch(console.error)
