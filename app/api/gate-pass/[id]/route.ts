import { NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePass } from '@/lib/gate-pass/server'
import { readGatePassEvents } from '@/lib/gate-pass/events'

export const dynamic = 'force-dynamic'

/** ⚠️ Next 16: `params` is a Promise and must be awaited. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    // getGatePass enforces the dealer scope itself — the permission alone would hand a Udhampur
    // user a Jammu pass.
    const pass = await getGatePass(access.appUser, id)
    const events = await readGatePassEvents(id)
    return NextResponse.json({ pass, events })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
