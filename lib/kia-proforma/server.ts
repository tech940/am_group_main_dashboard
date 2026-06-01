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

  return created
}

export async function touchKiaUserProfile(email: string) {
  await db
    .update(kiaUserProfiles)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(kiaUserProfiles.email, email))
}
