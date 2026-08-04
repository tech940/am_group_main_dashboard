const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDg5MjUsImV4cCI6MjA5MjU4NDkyNX0.5Bj3kN4aFWAvPo5LB2tpu8I0Nvq0jlslT-XYq_OUGtI'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function testMore() {
  console.log('[Test-More] Testing RPC functions or auth...')

  // Try decoding JWT to check ref
  const jwt = SUPABASE_ANON_KEY
  const parts = jwt.split('.')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
  console.log('[Test-More] JWT payload:', payload)

  // Test more table candidates
  const moreTables = [
    'call_recordings', 'cre_calls', 'calls', 'audio_files', 'recordings',
    'cre_audio', 'cre_call_recordings', 'sales_call_recordings',
    'service_call_recordings', 'leads', 'calls_log', 'cre_logs'
  ]

  for (const table of moreTables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      console.log(`Table '${table}' -> Error: ${error.message} (code: ${error.code})`)
    } else {
      console.log(`Table '${table}' -> DATA:`, data)
    }
  }
}

testMore().catch(console.error)
