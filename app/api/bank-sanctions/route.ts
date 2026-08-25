import { NextRequest, NextResponse } from 'next/server'
import { requireBankSanctionsApiAccess } from '@/lib/bank-sanctions/api-guard'
import {
  BankSanctionBranchError,
  BankSanctionValidationError,
  createBankSanction,
  listBankSanctions,
} from '@/lib/bank-sanctions/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    /*
     * The WHOLE register in one payload. The sheet made a server round trip per filter change
     * (location -> loan types -> rows); here the client filters a complete dataset locally, which
     * on a ~350ms-per-statement connection is strictly faster after the first load — and immune to
     * the paginate-then-filter mismatch this session found on the purchase-orders list.
     */
    // Scoped to the caller — a KIA login must not receive Hyundai's rows in the payload and then
    // rely on the client to hide them.
    const records = await listBankSanctions(gate.appUser)
    return NextResponse.json({ records })
  } catch (error) {
    console.error('GET /api/bank-sanctions failed:', error)
    return NextResponse.json({ error: 'Failed to load bank sanctions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    const body = await request.json().catch(() => ({}))
    const record = await createBankSanction(gate.appUser, body)
    return NextResponse.json({ record }, { status: 201 })
  } catch (error) {
    // Branch denial first: it is a subclass, so the generic catch below would otherwise swallow it
    // and report a scoping refusal as a malformed payload.
    if (error instanceof BankSanctionBranchError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof BankSanctionValidationError) {
      // Loud, named rejection — the duplicate message tells the user WHICH facility collided.
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('POST /api/bank-sanctions failed:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }
}
