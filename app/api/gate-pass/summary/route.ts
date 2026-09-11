import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { getGatePassSummary } from '@/lib/gate-pass/server'

export const dynamic = 'force-dynamic'

/**
 * The KPI strip: what is out, what is late, and how the gate is actually performing.
 *
 * ⚠️ It summarises the SAME scoped rows the list returns — getGatePassSummary applies the dealer
 * filter — so the headline numbers can never describe a wider set than the table beneath them.
 */
export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    const result = await getGatePassSummary(access.appUser, {
      ...params,
      status: undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
