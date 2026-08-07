import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { cancelFollowup, completeFollowup, updateFollowup } from '@/lib/kia/lead-followups'

export const dynamic = 'force-dynamic'

// PATCH handles reschedule/reassign/edit (action 'update'), completion ('complete'), and cancel.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.lead_followups.edit')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: 'update' | 'complete' | 'cancel'
      dueAt?: string; reason?: string; priority?: string; notes?: string; assignedTo?: string | null
      outcome?: string; nextDueAt?: string; notInterestedReason?: string; bookingStatus?: string
    }
    if (body.action === 'complete') {
      const result = await completeFollowup(appUser, id, {
        outcome: body.outcome,
        notes: body.notes,
        notInterestedReason: body.notInterestedReason,
        nextDueAt: body.nextDueAt,
      })
      return NextResponse.json(result)
    }
    if (body.action === 'cancel') {
      const result = await cancelFollowup(appUser, id)
      return NextResponse.json(result)
    }
    const result = await updateFollowup(appUser, id, {
      dueAt: body.dueAt,
      reason: body.reason,
      priority: body.priority,
      notes: body.notes,
      assignedTo: body.assignedTo,
      bookingStatus: body.bookingStatus,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update follow-up' }, { status: 400 })
  }
}
