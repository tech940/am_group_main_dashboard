import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { getDataHealthReport } from '@/lib/data-health/reader'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Feed-health report. Gated on a HARDCODED super-admin check rather than the permission registry:
 * this exposes table names, row counts and load timestamps across every brand, and it is an
 * operations tool, not a business section. Keeping it out of the registry also keeps it out of the
 * Access Map, so it cannot be granted sideways.
 */
export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isSuperAdminRole(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Local calendar date, not toISOString() — a UTC conversion rolls back a day in IST and would
    // make every feed read one day staler than it is.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const report = await getDataHealthReport(today)
    return NextResponse.json(report)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build the data health report' },
      { status: 500 },
    )
  }
}
