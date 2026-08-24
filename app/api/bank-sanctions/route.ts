import { NextRequest, NextResponse } from 'next/server'
import { requireBankSanctionsApiAccess } from '@/lib/bank-sanctions/api-guard'
import {
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
    const records = await listBankSanctions()
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
    if (error instanceof BankSanctionValidationError) {
      // Loud, named rejection — the duplicate message tells the user WHICH facility collided.
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('POST /api/bank-sanctions failed:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }
}
