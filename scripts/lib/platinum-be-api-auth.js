const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')
const { createServerClient } = require('@supabase/ssr')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function getProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0]
  } catch {
    return null
  }
}

function createCookieBackedClient(supabaseUrl, supabaseAnonKey) {
  const cookieJar = []
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieJar
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = cookieJar.findIndex((item) => item.name === cookie.name)
          if (index >= 0) cookieJar[index] = { name: cookie.name, value: cookie.value }
          else cookieJar.push({ name: cookie.name, value: cookie.value })
        }
      },
    },
  })

  return {
    supabase,
    getCookieHeader() {
      return cookieJar
        .filter(({ name }) => name.startsWith('sb-') && name.includes('auth-token'))
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ')
    },
  }
}

async function resolveApiUserEmail() {
  if (process.env.PLATINUM_BE_API_EMAIL?.trim()) {
    return process.env.PLATINUM_BE_API_EMAIL.trim()
  }

  if (!process.env.DATABASE_URL) return null

  const db = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    const [user] = await db`
      SELECT email
      FROM users
      WHERE is_active = true
        AND deleted_at IS NULL
        AND role IN ('admin', 'super_admin', 'ceo', 'md')
      ORDER BY
        CASE role
          WHEN 'admin' THEN 0
          WHEN 'super_admin' THEN 1
          ELSE 2
        END
      LIMIT 1
    `
    return user?.email || null
  } finally {
    await db.end()
  }
}

async function createCookieViaPassword(supabaseUrl, supabaseAnonKey, email, password) {
  const { supabase, getCookieHeader } = createCookieBackedClient(supabaseUrl, supabaseAnonKey)
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Supabase login failed for ${email}: ${error.message}`)
  }

  const cookieHeader = getCookieHeader()
  if (!cookieHeader) {
    throw new Error('Supabase password login succeeded but no auth cookie was issued.')
  }
  return cookieHeader
}

async function createCookieViaServiceRole(supabaseUrl, supabaseAnonKey, serviceRoleKey, email) {
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (error) {
    throw new Error(`Service-role magic link failed for ${email}: ${error.message}`)
  }

  const tokenHash = data?.properties?.hashed_token
  if (!tokenHash) {
    throw new Error(`Service-role magic link for ${email} did not return hashed_token.`)
  }

  const { supabase, getCookieHeader } = createCookieBackedClient(supabaseUrl, supabaseAnonKey)
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'email',
    token_hash: tokenHash,
  })
  if (verifyError) {
    throw new Error(`Magic-link verification failed for ${email}: ${verifyError.message}`)
  }

  const cookieHeader = getCookieHeader()
  if (!cookieHeader) {
    const projectRef = getProjectRef(supabaseUrl)
    throw new Error(
      `Magic-link verification succeeded but no auth cookie was issued${projectRef ? ` (expected sb-${projectRef}-auth-token*)` : ''}.`
    )
  }
  return cookieHeader
}

async function createPlatinumBeApiCookieHeader() {
  const explicitCookie = process.env.PLATINUM_BE_API_COOKIE?.trim()
  if (explicitCookie) return explicitCookie

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const password = process.env.PLATINUM_BE_API_PASSWORD

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  const email = await resolveApiUserEmail()
  if (!email) {
    return null
  }

  if (password) {
    return createCookieViaPassword(supabaseUrl, supabaseAnonKey, email, password)
  }

  if (serviceRoleKey) {
    return createCookieViaServiceRole(supabaseUrl, supabaseAnonKey, serviceRoleKey, email)
  }

  return null
}

module.exports = {
  createPlatinumBeApiCookieHeader,
}
