const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://ehcmjypfxucvcvuofozx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDg5MjUsImV4cCI6MjA5MjU4NDkyNX0.5Bj3kN4aFWAvPo5LB2tpu8I0Nvq0jlslT-XYq_OUGtI'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function testAll() {
  const tables = [
    'call_recordings', 'leads', 'calls', 'recordings', 'cre_calls',
    'cre_recordings', 'cre_call_logs', 'customers', 'cre_users',
    'cres', 'cre_performance', 'call_transcripts', 'transcripts',
    'audios', 'audio_recordings', 'telecaller_calls', 'telecaller_recordings',
    'analysis', 'call_analyses', 'call_sentiment', 'ai_analysis',
    'recordings_metadata', 'call_history', 'agent_calls', 'agents'
  ]

  const existingTables = []
  const permissionDeniedTables = []

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    if (error) {
      if (error.code === '42501') {
        permissionDeniedTables.push(table)
      }
    } else {
      existingTables.push({ table, count: data.length, sample: data })
    }
  }

  console.log('--- Permission Denied Tables (Exist with RLS): ---', permissionDeniedTables)
  console.log('--- Readable Tables (Public/Anon RLS): ---', existingTables)
}

testAll().catch(console.error)
