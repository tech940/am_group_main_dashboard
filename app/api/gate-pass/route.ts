import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { createGatePass, listGatePasses } from '@/lib/gate-pass/server'

export const dynamic = 'force-dynamic'

/**
 * Every handler in this module opens with requireGatePassAccess — the rule is stated once, in
 * lib/gate-pass/access.ts, and imported. Guard/API desync has caused four separate outages here,
 * each one a page and its routes restating the rule and drifting apart; the Vendor Registry shipped
 * a COMMENT claiming it was gated and no code at all.
 *
 * ⚠️ The guard answers "may you use this section". listGatePasses additionally scopes ROWS by
 * dealer — a correct permission with no row filter is how the whole group's payment ledger became
 * readable by anyone who could open the Registry.
 */

export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.view')
  if (access.denied) return access.denied

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    return NextResponse.json(await listGatePasses(access.appUser, params))
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.create')
  if (access.denied) return access.denied

  try {
    const body = await request.json().catch(() => ({}))
    const result = await createGatePass(access.appUser, body)
    /*
     * `unstaffed` is surfaced, not swallowed. A pass raised at a branch with no active approver is
     * written but nobody is told — the silent dead end that currently has seven petty-cash requests
     * parked at a stage with no holder. The requester needs to know to chase a human.
     */
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
