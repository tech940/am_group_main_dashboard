import { createClient } from '@supabase/supabase-js'
import { env } from '@/config/env-config'

/**
 * Admin client with service role key for server-side operations
 * Use with caution - has elevated permissions
 */
export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
