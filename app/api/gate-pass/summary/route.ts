import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { listGatePasses } from '@/lib/gate-pass/server'
import { summariseGatePasses } from '@/lib/gate-pass/metrics'

export const dynamic = 'force-dynamic'

/**
 * The KPI strip: what is out, what is late, and how the gate is actually performing.
 *
 * ⚠️ It summarises the SAME scoped rows the list returns — listGatePasses applies the dealer
 * filter — so the headline numbers can never describe a wider set than the table beneath them.
 * A summary computed over an unscoped query next to a scoped table is how a branch user comes to
 * see a group-wide total they are not entitled to, and then reconciles against the wrong figure.
 */
export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    /*
     * Deliberately unfiltered by status and taken in one page: the strip answers "how is the gate
     * doing", which needs open and closed passes together. 200 is comfortably above the real
     * volume here (a two-branch demo fleet of 27 cars), and the cap is reported rather than hidden
     * so a silent truncation cannot masquerade as a complete picture.
     */
    const PAGE = 200
    const { rows, total } = await listGatePasses(access.appUser, {
      ...params,
      status: undefined,
      page: 1,
      pageSize: PAGE,
    })

    return NextResponse.json({
      summary: summariseGatePasses(rows as never[]),
      truncated: total > PAGE,
      countedRows: rows.length,
      totalRows: total,
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
