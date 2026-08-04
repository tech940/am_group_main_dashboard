const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDg5MjUsImV4cCI6MjA5MjU4NDkyNX0.5Bj3kN4aFWAvPo5LB2tpu8I0Nvq0jlslT-XYq_OUGtI'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function testTables() {
  const commonTables = [
    'call_logs', 'calls', 'recordings', 'cre_calls', 'call_recordings',
    'call_analysis', 'cre_recordings', 'customer_calls', 'cre_call_logs',
    'audio_recordings', 'logs', 'transcripts', 'call_transcripts',
    'call_center_logs', 'call_data', 'cre_data', 'conversations',
    'messages', 'leads', 'feedbacks', 'reviews', 'profiles', 'users'
  ]

  for (const table of commonTables) {
    const { data, error } = await supabase.from(table).select('*').limit(2)
    if (!error) {
      console.log(`✅ Table '${table}' exists! Sample rows:`, data.length)
      if (data.length > 0) {
        console.log(JSON.stringify(data, null, 2))
      }
    } else {
      if (!error.message.includes('relation') && !error.message.includes('does not exist')) {
        console.log(`❓ Table '${table}' returned error:`, error.message)
      }
    }
  }
}

testTables().catch(console.error)
