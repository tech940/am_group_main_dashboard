const dotenv = require('dotenv')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDg5MjUsImV4cCI6MjA5MjU4NDkyNX0.5Bj3kN4aFWAvPo5LB2tpu8I0Nvq0jlslT-XYq_OUGtI'

async function inspect() {
  console.log('[Inspect-External] Fetching root REST OpenAPI spec...')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  })
  const text = await res.text()
  try {
    const spec = JSON.parse(text)
    if (spec.paths) {
      console.log('\n--- Available Tables & Routes ---')
      const routes = Object.keys(spec.paths).filter(p => p !== '/')
      console.log(routes)

      for (const route of routes) {
        const tableName = route.replace('/', '')
        console.log(`\n================ Table: ${tableName} ================`)
        const sampleRes = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=3`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        })
        const sampleData = await sampleRes.json()
        console.log(`Sample Data (${Array.isArray(sampleData) ? sampleData.length : 0} rows):`, JSON.stringify(sampleData, null, 2))
      }
    }
  } catch (e) {
    console.error('Error parsing JSON:', e.message, 'Raw response:', text.slice(0, 500))
  }
}

inspect()
