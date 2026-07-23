import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { createFollowup, listFollowups } from '@/lib/kia/lead-followups'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.lead_followups.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const url = new URL(request.url)
    const data = await listFollowups(appUser, {
      mine: url.searchParams.get('mine') === '1',
      search: url.searchParams.get('search'),
      reason: url.searchParams.get('reason'),
      dealer: url.searchParams.get('dealer'),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
      dateField: (url.searchParams.get('dateField') as 'due_date' | 'booking_date' | 'completed_date' | null) || null,
      model: url.searchParams.get('model'),
      bookingStatus: url.searchParams.get('bookingStatus'),
      priority: url.searchParams.get('priority'),
      assignedTo: url.searchParams.get('assignedTo'),
    })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load KIA follow-ups:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load follow-ups' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.lead_followups.create')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({})) as {
      bookingId?: string; dueAt?: string; reason?: string; priority?: string; notes?: string; assignedTo?: string
    }
    if (!body.bookingId || !body.dueAt) return NextResponse.json({ error: 'Missing booking or due date' }, { status: 400 })
    const row = await createFollowup(appUser, {
      bookingId: body.bookingId,
      dueAt: body.dueAt,
      reason: body.reason,
      priority: body.priority,
      notes: body.notes,
      assignedTo: body.assignedTo,
      source: 'manual',
    })
    return NextResponse.json({ ok: true, followup: row })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create follow-up' }, { status: 400 })
  }
}
