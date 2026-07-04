import { createClient } from '@supabase/supabase-js'
import { env } from '@/config/env-config'
import { fetchWithTimeout } from './fetch-timeout'

/**
 * Admin client with service role key for server-side operations
 * Use with caution - has elevated permissions
 */
export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    global: {
      fetch: fetchWithTimeout(10_000), // Timeout admin requests to Supabase after 10 seconds
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
