import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { mgUserProfiles } from '@/lib/db/schema'
import { canApproveMgProforma } from '@/lib/mg-proforma/access'

export async function ensureMgUserProfile(appUser?: AppUser | null) {
  const user = appUser ?? await getAuthenticatedAppUser()
  if (!user) return null

  const [existing] = await db
    .select()
    .from(mgUserProfiles)
    .where(eq(mgUserProfiles.email, user.email))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(mgUserProfiles)
    .values({
      authUserId: user.id,
      email: user.email,
      consultantName: user.fullName || user.email,
      dealerLocation: user.brand || 'mg',
      employeeCode: '',
      status: user.isActive ? 'ACTIVE' : 'INACTIVE',
      approver: canApproveMgProforma(user.role),
      settings: {},
      lastActivityAt: new Date(),
    })
    .returning()

  return created
}

export async function touchMgUserProfile(email: string) {
  await db
    .update(mgUserProfiles)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(mgUserProfiles.email, email))
}
