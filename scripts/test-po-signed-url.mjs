import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const path = process.argv[2] || 'vendor-images/8872ef86-850f-4377-abe4-72fbb9444f57_1781599940715_78k2bs.webp'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL')
  process.exit(1)
}

for (const [label, key] of [['service', serviceKey], ['anon', anonKey]]) {
  if (!key) {
    console.log(label, 'key missing')
    continue
  }
  const supabase = createClient(url, key)
  const { data, error } = await supabase.storage.from('purchase-orders').createSignedUrl(path, 900)
  console.log(label, { error: error?.message || null, signedUrl: data?.signedUrl?.slice(0, 120) || null })
  const list = await supabase.storage.from('purchase-orders').list(path.split('/')[0], { search: path.split('/').pop() })
  console.log(label, 'list', list.error?.message || list.data)
}
