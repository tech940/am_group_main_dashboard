import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { saveCallDisposition } from '@/lib/kia/call-center'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.call_center.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({})) as { callId?: string; disposition?: string; notes?: string; markCallbackContacted?: boolean; followUpAt?: string }
    if (!body.callId) return NextResponse.json({ error: 'Missing callId' }, { status: 400 })
    const result = await saveCallDisposition(appUser, {
      callId: body.callId,
      disposition: body.disposition,
      notes: body.notes,
      markCallbackContacted: Boolean(body.markCallbackContacted),
      followUpAt: body.followUpAt || null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save outcome' }, { status: 400 })
  }
}
