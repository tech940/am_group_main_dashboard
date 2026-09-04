import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { GatePassError, getGatePass } from '@/lib/gate-pass/server'
import { buildGateUrl, createGateToken } from '@/lib/gate-pass/token'
import { qrDataUrl } from '@/lib/gate-pass/qr'
import { getAppBaseUrl } from '@/lib/approvals/decision-emails'

export const dynamic = 'force-dynamic'

/**
 * Re-issue the QR for a pass, so it can be shown on screen or reprinted when the email is lost.
 *
 * ⚠️ The purpose is derived from the pass's CURRENT status, never taken from the caller. A caller
 * who could ask for an 'in' token on an approved pass would be able to sign a vehicle back in
 * before it ever left — which is the one thing the whole token design exists to prevent.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const { id } = await params
    // getGatePass enforces the dealer scope, so a QR cannot be minted for another branch's pass.
    const pass = await getGatePass(access.appUser, id)

    const purpose = pass.status === 'approved' ? 'out' : pass.status === 'out' ? 'in' : null
    if (!purpose) {
      throw new GatePassError(
        pass.status === 'pending_approval'
          ? 'This pass has not been approved yet.'
          : 'This pass is closed, so there is no code to show.',
        409,
      )
    }

    const token = createGateToken({
      passId: pass.id,
      purpose,
      expectedReturnAt: pass.expectedReturnAt,
      issuedAt: new Date(),
    })
    const url = buildGateUrl(getAppBaseUrl(), token)

    return NextResponse.json(
      { url, dataUrl: await qrDataUrl(url), purpose },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
