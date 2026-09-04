import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { cancelGatePass } from '@/lib/gate-pass/server'

/**
 * Cancel a pass.
 *
 * Guarded on `gate_pass.create`, not `approve`, because the requester withdrawing their own request
 * is the common case; cancelGatePass then allows either the person who raised it or anyone who
 * could have approved it. Gating this on `approve` would leave a sales executive unable to withdraw
 * a request they raised by mistake, which just produces a rejected pass and a wasted approval.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason : null
    return NextResponse.json({ pass: await cancelGatePass(access.appUser, id, reason) })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
