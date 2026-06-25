import 'server-only'

import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { db } from '@/lib/db'
import { findAuthUserBySupabaseId } from '@/lib/db/auth-client'
import { users } from '@/lib/db/schema'
import { getRedisClient } from '@/lib/redis/client'
import { supabaseAdmin } from '@/lib/supabase/admin'
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

const APP_USER_CACHE_TTL_MS = 10 * 60_000
const APP_USER_REDIS_TTL_SECONDS = 24 * 60 * 60
const AUTH_USER_CACHE_TTL_MS = 30_000
const appUserCache = new Map<string, { expiresAt: number; user: AppUser | null }>()
const appUserLookupPromises = new Map<string, Promise<AppUser | null>>()
const authUserCache = new Map<string, { expiresAt: number; supabaseId: string | null }>()
const authUserLookupPromises = new Map<string, Promise<string | null>>()

export function clearAppUserCache(supabaseId?: string | null) {
  if (supabaseId) {
    appUserCache.delete(supabaseId)
    appUserLookupPromises.delete(supabaseId)
    void getRedisClient()?.del(appUserRedisKey(supabaseId)).catch(() => null)
    return
  }

  appUserCache.clear()
  appUserLookupPromises.clear()
  authUserCache.clear()
  authUserLookupPromises.clear()
}

function isTransientDbConnectionError(error: unknown) {
  const signals: string[] = []
  let current: unknown = error

  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) signals.push(current.message)
    if (typeof current === 'object' && current !== null) {
      if ('code' in current) signals.push(String((current as { code?: unknown }).code || ''))
      current = 'cause' in current ? (current as { cause?: unknown }).cause : null
    } else {
      signals.push(String(current))
      current = null
    }
  }

  const combined = signals.join(' ')
  return combined.includes('CONNECT_TIMEOUT')
    || combined.includes('ECHECKOUTTIMEOUT')
    || combined.includes('unable to check out connection from the pool')
    || combined.includes('Connection terminated')
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

function appUserRedisKey(supabaseId: string) {
  return `auth:app-user:v1:${supabaseId}`
}

function isAppUser(value: unknown): value is AppUser {
  if (!value || typeof value !== 'object') return false
  const user = value as Partial<AppUser>
  return typeof user.id === 'string'
    && typeof user.supabaseId === 'string'
    && typeof user.email === 'string'
    && typeof user.fullName === 'string'
    && typeof user.role === 'string'
    && typeof user.isActive === 'boolean'
}

async function readPersistentAppUser(supabaseId: string) {
  try {
    const cached = await getRedisClient()?.get<unknown>(appUserRedisKey(supabaseId))
    return isAppUser(cached) && cached.supabaseId === supabaseId ? cached : null
  } catch {
    return null
  }
}

async function writePersistentAppUser(user: AppUser) {
  try {
    await getRedisClient()?.setex(
      appUserRedisKey(user.supabaseId),
      APP_USER_REDIS_TTL_SECONDS,
      user
    )
  } catch {
    // Authentication must not fail because the optional persistent cache failed.
  }
}

async function findAppUserBySupabaseIdViaRest(supabaseId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id,supabase_id,email,full_name,role,brand,department,is_active')
    .eq('supabase_id', supabaseId)
    .is('deleted_at', null)
    .abortSignal(AbortSignal.timeout(3_000))
    .maybeSingle()

  if (error) throw error
  if (!data) return undefined

  return {
    id: String(data.id),
    supabaseId: String(data.supabase_id),
    email: String(data.email),
    fullName: String(data.full_name),
    role: data.role as AppUser['role'],
    brand: data.brand === null ? null : String(data.brand),
    department: data.department === null ? null : String(data.department),
    isActive: Boolean(data.is_active),
  }
}

async function findAppUserBySupabaseIdViaSessionPool(supabaseId: string) {
  const data = await findAuthUserBySupabaseId(supabaseId)
  if (!data) return undefined

  return {
    id: String(data.id),
    supabaseId: String(data.supabase_id),
    email: String(data.email),
    fullName: String(data.full_name),
    role: data.role as AppUser['role'],
    brand: data.brand,
    department: data.department,
    isActive: Boolean(data.is_active),
  }
}

async function getSupabaseUserId() {
  const supabase = await createClient()
  try {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
    const claims = claimsData?.claims as { sub?: unknown } | undefined
    const claimUserId = typeof claims?.sub === 'string' ? claims.sub : null

    if (!claimsError && claimUserId) {
      return claimUserId
    }
  } catch {
    // Expired access tokens can still have a valid refresh token.
  }

  const cookieStore = await cookies()
  const authCookieValue = cookieStore.getAll()
    .filter(({ name }) => name.startsWith('sb-') && name.includes('auth-token'))
    .map(({ name, value }) => `${name}=${value}`)
    .sort()
    .join(';')

  if (!authCookieValue) return null

  const cacheKey = createHash('sha256').update(authCookieValue).digest('hex')
  const cached = authUserCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.supabaseId

  const pending = authUserLookupPromises.get(cacheKey)
  if (pending) return await pending

  const lookup = (async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser()
      const supabaseId = error || !user ? null : user.id
      authUserCache.set(cacheKey, {
        expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
        supabaseId,
      })
      return supabaseId
    } catch {
      return null
    }
  })()

  authUserLookupPromises.set(cacheKey, lookup)
  try {
    return await lookup
  } finally {
    authUserLookupPromises.delete(cacheKey)
  }
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
    const persistentUser = await readPersistentAppUser(supabaseId)
    if (persistentUser?.isActive) {
      appUserCache.set(supabaseId, {
        expiresAt: Date.now() + APP_USER_CACHE_TTL_MS,
        user: persistentUser,
      })
      return persistentUser
    }

    let appUser: AppUser | undefined
    try {
      appUser = await findAppUserBySupabaseId(supabaseId)
    } catch (error) {
      if (!isTransientDbConnectionError(error)) {
        throw error
      }

      try {
        await wait(250)
        appUser = await findAppUserBySupabaseId(supabaseId)
      } catch (retryError) {
        if (isTransientDbConnectionError(retryError)) {
          try {
            appUser = await findAppUserBySupabaseIdViaSessionPool(supabaseId)
          } catch {
            try {
              appUser = await findAppUserBySupabaseIdViaRest(supabaseId)
            } catch (restError) {
              if (cached?.user?.isActive) {
                appUserCache.set(supabaseId, {
                  expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
                  user: cached.user,
                })
                return cached.user
              }
              throw restError
            }
          }
        } else {
          throw retryError
        }
      }
    }

    const activeUser = appUser && appUser.isActive ? appUser : null
    appUserCache.set(supabaseId, {
      expiresAt: Date.now() + APP_USER_CACHE_TTL_MS,
      user: activeUser,
    })
    if (activeUser) await writePersistentAppUser(activeUser)
    return activeUser
  })()

  appUserLookupPromises.set(supabaseId, lookup)
  try {
    return await lookup
  } finally {
    appUserLookupPromises.delete(supabaseId)
  }
}

const getAuthenticatedAppUserCached = cache(async () => {
  const supabaseId = await getSupabaseUserId()
  if (!supabaseId) return null

  const appUser = await getCachedAppUserBySupabaseId(supabaseId)

  if (!appUser || !appUser.isActive) {
    return null
  }

  return appUser satisfies AppUser
})

export async function getAuthenticatedAppUser() {
  return await getAuthenticatedAppUserCached()
}
