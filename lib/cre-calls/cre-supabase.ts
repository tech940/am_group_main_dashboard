import { createClient, SupabaseClient } from '@supabase/supabase-js'

const CRE_SUPABASE_URL = process.env.AM_GROUP_CRE_SUPABASE_URL || 'https://ehcmjypfxucvcvuofozx.supabase.co'
const CRE_SUPABASE_SERVICE_ROLE_KEY = process.env.AM_GROUP_CRE_SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoY21qeXBmeHVjdmN2dW9mb3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzAwODkyNSwiZXhwIjoyMDkyNTg0OTI1fQ.nynYDrFDHiyn74UykpX4A3sjyfNXp5A_7Uy6auKWdZI'

let creSupabaseInstance: SupabaseClient | null = null

export function getCreSupabase(): SupabaseClient {
  if (!creSupabaseInstance) {
    creSupabaseInstance = createClient(CRE_SUPABASE_URL, CRE_SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return creSupabaseInstance
}
