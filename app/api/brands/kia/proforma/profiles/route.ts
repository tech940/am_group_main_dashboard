import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaUserProfiles } from '@/lib/db/schema'
import { canApproveKiaProforma } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'

export const dynamic = 'force-dynamic'

function text(value: unknown) {
  return String(value ?? '').trim()
}

export async function GET() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile || !canApproveKiaProforma(appUser.role, profile.approver)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [profiles, statsRows] = await Promise.all([
    db.select().from(kiaUserProfiles).orderBy(asc(kiaUserProfiles.consultantName)),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE status = 'INACTIVE')::int AS inactive,
        COUNT(*) FILTER (WHERE status = 'NEW USER')::int AS new_user
      FROM kia_user_profiles
    `),
  ])

  const stats = Array.isArray(statsRows) ? statsRows[0] : { active: 0, inactive: 0, new_user: 0 }
  return NextResponse.json({ profiles, stats })
}

export async function PATCH(request: NextRequest) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile || !canApproveKiaProforma(appUser.role, profile.approver)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = text(body.id)
  if (!id) return NextResponse.json({ error: 'Profile id is required' }, { status: 400 })
  const status = text(body.status) || 'ACTIVE'
  const approver = String(body.approver).toLowerCase() === 'true' || body.approver === true
  const [updated] = await db
    .update(kiaUserProfiles)
    .set({
      status,
      approver,
      lastActivityAt: status === 'ACTIVE' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(kiaUserProfiles.id, id))
    .returning()

  return NextResponse.json({ profile: updated })
}
