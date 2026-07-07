import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/config/env-config'
import { fetchWithTimeout } from './fetch-timeout'

function build() {
  return createBrowserClient(
    env.supabase.url,
    env.supabase.anonKey,
    {
      global: {
        fetch: fetchWithTimeout(10_000), // Timeout browser requests to Supabase after 10 seconds
      },
      auth: {
        persistSession: true,
        // Proactively refresh the access token before it expires so the user stays
        // signed in until they explicitly log out. supabase-js single-flights the
        // refresh via the Web Locks API and also refreshes when the tab regains
        // focus, so a burst of requests (or a backgrounded tab) can't trigger the
        // "refresh token already used" race that would otherwise sign the user out.
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  )
}

// Memoise ONE browser client so there is exactly one token-refresh loop for the tab.
// Multiple GoTrueClient instances each run their own refresh timer and can race on
// refresh-token rotation, which silently logs the user out. Never memoise on the
// server — module scope is shared across requests there, which would leak one user's
// session to another.
let browserClient: ReturnType<typeof build> | null = null

export function createClient() {
  if (typeof window === 'undefined') return build()
  if (!browserClient) browserClient = build()
  return browserClient
}
