import dotenv from 'dotenv'
dotenv.config()
import { createClient } from '@supabase/supabase-js'

const url = process.env.AM_GROUP_CRE_SUPABASE_URL
const key = process.env.AM_GROUP_CRE_SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(url!, key!)

async function run() {
  const branchId = '4d1d906b-6850-4a90-8309-e2ed9e61c6cb'
  const { data: recs, error } = await supabase
    .from('call_recordings')
    .select('*')
    .or(`branch_id.eq.${branchId},cre_id.eq.574ca8be-c9c8-4feb-9cda-6f8b6a35d1e9`)
    .order('recorded_at', { ascending: false })

  console.log('Recordings count:', recs?.length, 'Error:', error)
  if (recs && recs.length > 0) {
    console.table(recs.map(r => ({
      id: r.id,
      phone: r.phone,
      contact_name: r.contact_name,
      file_name: r.file_name,
      duration_seconds: r.duration_seconds,
      call_type: r.call_type,
      upload_status: r.upload_status,
      recorded_at: r.recorded_at || r.created_at,
      storage_path: r.storage_path
    })))
  }
}

run()
