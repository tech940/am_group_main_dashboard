import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { kiaUserProfiles } from '@/lib/db/schema'
import { canApproveKiaProforma } from '@/lib/kia-proforma/access'

export async function ensureKiaUserProfile(appUser?: AppUser | null) {
  const user = appUser ?? await getAuthenticatedAppUser()
  if (!user) return null

  const [existing] = await db
    .select()
    .from(kiaUserProfiles)
    .where(eq(kiaUserProfiles.email, user.email))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(kiaUserProfiles)
    .values({
      authUserId: user.id,
      email: user.email,
      consultantName: user.fullName || user.email,
      dealerLocation: user.brand || 'kia',
      employeeCode: '',
      status: user.isActive ? 'ACTIVE' : 'INACTIVE',
      approver: canApproveKiaProforma(user.role),
      settings: {},
      lastActivityAt: new Date(),
    })
    .returning()

  // Drop any negative (null) cache entry so a read that just missed picks up the freshly-created row.
  clearKiaUserProfileCache(user.email)
  return created
}

// Short-TTL read-only cache of a KIA user profile by email, for hot read paths (e.g. the booking
// detail endpoint, which is hover-prefetched per row and only needs `consultantName`). Unlike
// ensureKiaUserProfile it never writes — a GET must not create rows, and creating on every prefetch
// under connection pressure both races on the unique(email) index and burns a round trip per call.
// The profile is stable across a burst from one user, so a 60s TTL collapses the whole burst to one
// lookup. Invalidated on write via clearKiaUserProfileCache.
const KIA_PROFILE_CACHE_TTL_MS = 60_000
const kiaProfileCache = new Map<string, { expiresAt: number; profile: typeof kiaUserProfiles.$inferSelect | null }>()

export function clearKiaUserProfileCache(email?: string) {
  if (email) kiaProfileCache.delete(email)
  else kiaProfileCache.clear()
}

export async function getCachedKiaUserProfile(email: string | null | undefined) {
  if (!email) return null
  const now = Date.now()
  const cached = kiaProfileCache.get(email)
  if (cached && cached.expiresAt > now) return cached.profile

  const [profile] = await db
    .select()
    .from(kiaUserProfiles)
    .where(eq(kiaUserProfiles.email, email))
    .limit(1)

  kiaProfileCache.set(email, { expiresAt: now + KIA_PROFILE_CACHE_TTL_MS, profile: profile ?? null })
  return profile ?? null
}

export async function touchKiaUserProfile(email: string) {
  clearKiaUserProfileCache(email)
  await db
    .update(kiaUserProfiles)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(kiaUserProfiles.email, email))
}
