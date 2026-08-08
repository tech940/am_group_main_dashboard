import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getGroupCockpit } from '@/lib/cockpit/cockpit-data'

export const dynamic = 'force-dynamic'
// A fully cold build (no fresh key, no stale key — e.g. first hit after a quiet stretch) fans out
// to every brand's canonical aggregation and runs in-request. At the platform's default duration
// it was killed mid-flight, which the browser reports as a bare "Failed to fetch".
export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'cockpit.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const { searchParams } = new URL(request.url)
    const endDate = searchParams.get('endDate')
    const data = await getGroupCockpit({ endDate: endDate && DATE.test(endDate) ? endDate : null })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Cockpit summary failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load cockpit' }, { status: 500 })
  }
}
