import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { resendGatePassEmail } from '@/lib/gate-pass/server'

export const dynamic = 'force-dynamic'

/**
 * Send / re-send the gate pass QR barcode and link to the submitter's email address.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    const result = await resendGatePassEmail(access.appUser, id, request)
    return NextResponse.json(result)
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
