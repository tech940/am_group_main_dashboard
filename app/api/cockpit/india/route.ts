import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getIndiaSnapshot, indiaToday } from '@/lib/cockpit/india-snapshot'

export const dynamic = 'force-dynamic'
/*
 * Three aggregates across six feeds. Warm they total under a second, but a cold build after a quiet
 * stretch pays first-connection setup on top — and at the platform default that is killed mid-flight
 * and reported to the browser as a bare "Failed to fetch". Same reasoning as the cockpit route.
 */
export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Shares the cockpit's permission: it is the same audience and the same page.
  const permission = await requirePermission(appUser, 'cockpit.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const day = new URL(request.url).searchParams.get('day')
    const data = await getIndiaSnapshot({ day: day && DATE.test(day) ? day : indiaToday() })
    return NextResponse.json(data)
  } catch (error) {
    console.error('India snapshot failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load the India snapshot' },
      { status: 500 },
    )
  }
}
