import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgUserProfiles } from '@/lib/db/schema'
import { ensureMgUserProfile } from '@/lib/mg-proforma/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  const accessResponse = await requireBrandApiAccess('mg')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureMgUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const settings = {
    ...(profile.settings || {}),
    ...(body.settings && typeof body.settings === 'object' ? body.settings as Record<string, unknown> : {}),
  }

  const [updated] = await db
    .update(mgUserProfiles)
    .set({ settings, updatedAt: new Date() })
    .where(eq(mgUserProfiles.id, profile.id))
    .returning()

  return NextResponse.json({ profile: updated })
}
