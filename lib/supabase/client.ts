import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/config/env-config'

export function createClient() {
  return createBrowserClient(
    env.supabase.url,
    env.supabase.anonKey,
    {
      auth: {
        persistSession: true,
        // API requests perform a single-flight refresh on a real 401. Avoid
        // timer-driven refresh loops when the workstation clock is skewed.
        autoRefreshToken: false,
        detectSessionInUrl: true,
      },
    }
  )
}
