const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODkyNSwiZXhwIjoyMDkyNTg0OTI1fQ.nynYDrFDHiyn74UykpX4A3sjyfNXp5A_7Uy6auKWdZI'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function main() {
  console.log('[Inspect-ServiceRole] Querying tables with service_role_key...')

  const tables = ['call_recordings', 'call_analyses', 'leads', 'customers']

  for (const table of tables) {
    console.log(`\n=================== Table: ${table} ===================`)
    const { data, error, count } = await supabase.from(table).select('*', { count: 'exact' }).limit(3)
    if (error) {
      console.error(`Error querying ${table}:`, error)
    } else {
      console.log(`Row Count:`, count)
      console.log(`Sample Data:`, JSON.stringify(data, null, 2))
    }
  }
}

main().catch(console.error)
