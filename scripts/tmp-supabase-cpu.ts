/* TEMP probe — PURE-JS cost of the per-request auth chain pieces. No network, no DB. */
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { config } from 'dotenv'
config()

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'x'.repeat(40)

function bench(label: string, iters: number, fn: () => unknown) {
  for (let i = 0; i < Math.min(iters, 50); i++) fn()
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  console.log('  ' + label.padEnd(50) + (ms / iters).toFixed(4).padStart(9) + ' ms/op')
  return ms / iters
}

const fakeCookies = [
  { name: 'sb-abcdefgh-auth-token.0', value: 'base64-' + 'A'.repeat(1800) },
  { name: 'sb-abcdefgh-auth-token.1', value: 'B'.repeat(1200) },
  { name: 'other', value: 'z' },
]

console.log('=== per-request Supabase client construction (lib/supabase/server.ts createClient) ===')
bench('createServerClient() @supabase/ssr', 2000, () =>
  createServerClient(URL, ANON, {
    cookies: { getAll: () => fakeCookies, setAll: () => {} },
  })
)

console.log()
console.log('=== module-scope admin client (lib/supabase/admin.ts) — paid once per COLD START ===')
bench('createClient() @supabase/supabase-js', 500, () =>
  createClient(URL, 'service-role-key', { auth: { autoRefreshToken: false, persistSession: false } })
)

console.log()
console.log('=== cookie hashing done per request in getSupabaseUserId (app-user.ts:219) ===')
const cookieVal = fakeCookies.map((c) => `${c.name}=${c.value}`).sort().join(';')
console.log('  auth cookie length:', cookieVal.length, 'chars')
bench('createHash(sha256).update(cookies).digest()', 20000, () =>
  createHash('sha256').update(cookieVal).digest('hex')
)

console.log()
console.log('=== JWT decode (what getClaims does locally before any network) ===')
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const payload = Buffer.from(JSON.stringify({
  sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated', exp: 9999999999,
  app_metadata: {}, user_metadata: { full_name: 'X' }, aud: 'authenticated',
})).toString('base64url')
const jwt = `${header}.${payload}.${'sig'.repeat(20)}`
bench('decode JWT payload (base64url + JSON.parse)', 20000, () =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
)
