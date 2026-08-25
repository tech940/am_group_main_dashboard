import { NextRequest, NextResponse } from 'next/server'
import { requireBankSanctionsApiAccess } from '@/lib/bank-sanctions/api-guard'
import { BankSanctionBranchError, getBankSanctionHistory } from '@/lib/bank-sanctions/store'

export const dynamic = 'force-dynamic'

/** Full audit trail for one record — the sheet's "Form Responses 1" view, plus who changed it. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    const { id } = await context.params
    const history = await getBankSanctionHistory(gate.appUser, id)
    return NextResponse.json({ history })
  } catch (error) {
    // Reading another branch's history is a refusal, not a server fault.
    if (error instanceof BankSanctionBranchError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('GET /api/bank-sanctions/[id]/history failed:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
