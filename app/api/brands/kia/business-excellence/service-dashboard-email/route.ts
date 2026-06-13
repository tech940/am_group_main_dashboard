import { NextRequest, NextResponse } from 'next/server'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { sendServiceDashboardEmail } from '@/lib/reports/service-dashboard-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SEND_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'ceo', 'md', 'manager'])

function readStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)
  return []
}

export async function POST(request: NextRequest) {
  const timer = createApiTimer('kia-service-dashboard-email')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'kia') || !SEND_ALLOWED_ROLES.has(String(appUser.role || '').toLowerCase())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const result = await timer.time('send-email', () => sendServiceDashboardEmail({
      brand: 'kia',
      reportKey: 'service-dashboard',
      endDate: typeof body.endDate === 'string' ? body.endDate : null,
      dealerCode: normalizeKiaDealerCode(typeof body.dealerCode === 'string' ? body.dealerCode : null),
      recipients: readStringArray(body.recipients),
      cc: readStringArray(body.cc),
      bcc: readStringArray(body.bcc),
      trigger: 'manual',
    }))
    const timing = timer.finish()
    const response = NextResponse.json({
      success: true,
      ...result,
    })

    return withServerTiming(response, timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to send KIA Service Dashboard email:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to send Service Dashboard email',
    }, { status: 500 })
  }
}
