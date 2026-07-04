import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/config/env-config'
import { fetchWithTimeout } from './fetch-timeout'

export function createClient() {
  return createBrowserClient(
    env.supabase.url,
    env.supabase.anonKey,
    {
      global: {
        fetch: fetchWithTimeout(10_000), // Timeout browser requests to Supabase after 10 seconds
      },
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
