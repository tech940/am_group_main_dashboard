import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Client for the CRE call-tracking Supabase project (`ehcmjypfxucvcvuofozx`).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * SECURITY — read before touching this file.
 *
 * `AM_GROUP_CRE_SUPABASE_SERVICE_ROLE_KEY` is a SERVICE-ROLE key. It BYPASSES ALL ROW-LEVEL
 * SECURITY on that project and can read and write every table in it. It must therefore:
 *   - stay server-side only. Never re-export it, never prefix it with `NEXT_PUBLIC_`, and never
 *     import this module from a client component. The guard below turns that mistake into a loud
 *     runtime error instead of a key shipped in a JS bundle.
 *   - come from the environment. It previously lived in this file as a hardcoded fallback string
 *     and was COMMITTED TO GIT, so it is in the repository history and must be treated as leaked.
 *
 * ⚠️ OWNER ACTION REQUIRED — ROTATE THE KEY.
 * Removing the literal here does not un-leak it: anyone with the repo history still has a working
 * service-role key. Rotate it in the Supabase console
 * (project ehcmjypfxucvcvuofozx > Project Settings > API Keys > service_role > Rotate), then set
 * the new value in `.env` locally and in the Vercel project environment. This cannot be done from
 * the codebase.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * DATA POLICY: this project's schema is PRODUCTION and the CRE handsets own it. Everything the
 * dashboard does here is READ ONLY — never insert, update, upsert or delete `call_recordings`,
 * `call_log_entries` or `device_sync_health`.
 */

/** Read a required server-side variable, failing loudly rather than falling back to a literal. */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(
      `[cre-supabase] Missing required environment variable ${name}. ` +
        'The AM Group CRE Call Analysis section reads a separate Supabase project and has no ' +
        'fallback credentials by design. Set AM_GROUP_CRE_SUPABASE_URL and ' +
        'AM_GROUP_CRE_SUPABASE_SERVICE_ROLE_KEY in .env (local) and in the Vercel project ' +
        'environment (deployed).'
    )
  }
  return value.trim()
}

let creSupabaseInstance: SupabaseClient | null = null

export function getCreSupabase(): SupabaseClient {
  // A service-role client in a browser bundle is a full data breach, so refuse to construct one
  // there even if an import path ever makes it that far.
  if (typeof window !== 'undefined') {
    throw new Error(
      '[cre-supabase] getCreSupabase() was called in the browser. This client holds a ' +
        'service-role key and may only be constructed on the server (API routes / server modules).'
    )
  }

  if (!creSupabaseInstance) {
    creSupabaseInstance = createClient(
      requireEnv('AM_GROUP_CRE_SUPABASE_URL'),
      requireEnv('AM_GROUP_CRE_SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )
  }
  return creSupabaseInstance
}
