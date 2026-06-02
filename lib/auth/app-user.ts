import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

export type AppUser = {
  id: string
  supabaseId: string
  email: string
  fullName: string
  role: typeof users.$inferSelect.role
  brand: string | null
  department: string | null
  isActive: boolean
}

const APP_USER_CACHE_TTL_MS = 60_000
const appUserCache = new Map<string, { expiresAt: number; user: AppUser | null }>()
const appUserLookupPromises = new Map<string, Promise<AppUser | null>>()

function isTransientDbConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  const causeCode = typeof error === 'object' && error !== null && 'cause' in error
    && typeof (error as { cause?: unknown }).cause === 'object'
    && (error as { cause?: unknown }).cause !== null
    && 'code' in ((error as { cause?: unknown }).cause as Record<string, unknown>)
    ? String(((error as { cause?: { code?: unknown } }).cause?.code))
    : ''

  return code === 'CONNECT_TIMEOUT'
    || causeCode === 'CONNECT_TIMEOUT'
    || message.includes('CONNECT_TIMEOUT')
    || message.includes('Connection terminated')
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function findAppUserBySupabaseId(supabaseId: string) {
  const [appUser] = await db
    .select({
      id: users.id,
      supabaseId: users.supabaseId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      department: users.department,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.supabaseId, supabaseId), isNull(users.deletedAt)))
    .limit(1)

  return appUser
}

async function getSupabaseUserId() {
  const supabase = await createClient()
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const claims = claimsData?.claims as { sub?: unknown } | undefined
  const claimUserId = typeof claims?.sub === 'string' ? claims.sub : null

  if (!claimsError && claimUserId) {
    return claimUserId
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  return user.id
}

async function getCachedAppUserBySupabaseId(supabaseId: string) {
  const now = Date.now()
  const cached = appUserCache.get(supabaseId)
  if (cached && cached.expiresAt > now) {
    return cached.user
  }

  const pending = appUserLookupPromises.get(supabaseId)
  if (pending) return await pending

  const lookup = (async () => {
    let appUser: Awaited<ReturnType<typeof findAppUserBySupabaseId>>
    try {
      appUser = await findAppUserBySupabaseId(supabaseId)
    } catch (error) {
      if (!isTransientDbConnectionError(error)) {
        throw error
      }

      await wait(350)
      appUser = await findAppUserBySupabaseId(supabaseId)
    }

    const activeUser = appUser && appUser.isActive ? appUser : null
    appUserCache.set(supabaseId, {
      expiresAt: Date.now() + APP_USER_CACHE_TTL_MS,
      user: activeUser,
    })
    return activeUser
  })()

  appUserLookupPromises.set(supabaseId, lookup)
  try {
    return await lookup
  } finally {
    appUserLookupPromises.delete(supabaseId)
  }
}

export async function getAuthenticatedAppUser() {
  const supabaseId = await getSupabaseUserId()
  if (!supabaseId) return null

  const appUser = await getCachedAppUserBySupabaseId(supabaseId)

  if (!appUser || !appUser.isActive) {
    return null
  }

  return appUser satisfies AppUser
}
