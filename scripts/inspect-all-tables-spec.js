const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODkyNSwiZXhwIjoyMDkyNTg0OTI1fQ.nynYDrFDHiyn74UykpX4A3sjyfNXp5A_7Uy6auKWdZI'

async function inspectAll() {
  console.log('[Inspect-All] Fetching OpenAPI spec with service_role_key...')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SERVICE_ROLE_KEY}`, {
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`
    }
  })
  const spec = await res.json()
  if (spec && spec.definitions) {
    const tableNames = Object.keys(spec.definitions)
    console.log('[Inspect-All] Tables defined in database:', tableNames)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    for (const t of tableNames) {
      const { data, count, error } = await supabase.from(t).select('*', { count: 'exact' }).limit(3)
      if (error) {
        console.log(`Table ${t} error:`, error.message)
      } else {
        console.log(`\n--- Table: ${t} (${count} rows) ---`)
        console.log('Columns:', Object.keys(data[0] || {}))
        if (data.length > 0) {
          console.log('Sample row:', data[0])
        }
      }
    }
  }
}

inspectAll().catch(console.error)
