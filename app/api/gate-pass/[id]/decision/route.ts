import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { decideGatePass } from '@/lib/gate-pass/server'

/**
 * Approve or reject.
 *
 * ⚠️ `gate_pass.approve` is only half the check. decideGatePass ALSO tests the pass's dealer code
 * against the approver's branch scope, because a Sales Manager pinned to Udhampur signing out a
 * Jammu car is exactly what the branch pin exists to prevent. Permission says "you are an
 * approver"; scope says "of this branch".
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.approve')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as { decision?: unknown; remarks?: unknown }
    const decision = String(body.decision ?? '').trim().toLowerCase()
    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'Decision must be approve or reject.' }, { status: 400 })
    }
    const remarks = typeof body.remarks === 'string' ? body.remarks : null

    // The request is passed through so the QR link is built against the host the user is actually
    // on — a link baked to the wrong origin is a QR that 404s at the gate.
    const pass = await decideGatePass(access.appUser, id, decision, remarks, request)
    return NextResponse.json({ pass })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
