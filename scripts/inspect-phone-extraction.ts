import { getCreSupabase } from '../lib/cre-calls/cre-supabase'

async function inspectPhoneExtraction() {
  const supabase = getCreSupabase()

  const { data: recs, error } = await supabase
    .from('call_recordings')
    .select('id, phone, contact_name, file_name, source_path, local_uri')

  if (error) {
    console.error(error)
    return
  }

  console.log('Total rows:', recs.length)
  const nullPhones = recs.filter(r => !r.phone || r.phone === 'null' || r.phone === 'Unknown Phone')
  console.log('Rows with null/missing phone:', nullPhones.length)

  console.log('\nSample rows with missing phone:')
  nullPhones.slice(0, 15).forEach(r => {
    console.log({
      id: r.id,
      phone: r.phone,
      file_name: r.file_name,
      source_path: r.source_path,
      local_uri: r.local_uri
    })
  })
}

inspectPhoneExtraction().catch(console.error)
