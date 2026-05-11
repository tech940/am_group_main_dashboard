import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/config/env-config'

export function createClient() {
  return createBrowserClient(
    env.supabase.url,
    env.supabase.anonKey
  )
}
