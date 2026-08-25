import { NextRequest, NextResponse } from 'next/server'
import { requireBankSanctionsApiAccess } from '@/lib/bank-sanctions/api-guard'
import {
  BankSanctionBranchError,
  BankSanctionValidationError,
  deleteBankSanction,
  updateBankSanction,
} from '@/lib/bank-sanctions/store'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const record = await updateBankSanction(gate.appUser, id, body)
    return NextResponse.json({ record })
  } catch (error) {
    // Branch denial first: it is a subclass, so the generic catch below would otherwise swallow it
    // and report a scoping refusal as a malformed payload.
    if (error instanceof BankSanctionBranchError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof BankSanctionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('PATCH /api/bank-sanctions/[id] failed:', error)
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
  }
}

/**
 * Delete is open to the same four roles as the section, but unlike the sheet — which gated it on a
 * password hardcoded in client-side JavaScript and then lost the row entirely — the final snapshot
 * is written to bank_sanction_history first, in the same transaction, with who deleted it.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireBankSanctionsApiAccess()
    if (gate.response) return gate.response

    const { id } = await context.params
    const result = await deleteBankSanction(gate.appUser, id)
    console.warn('[bank-sanctions] record deleted by %s: %s', gate.appUser.email, result.loanType)
    return NextResponse.json(result)
  } catch (error) {
    // Branch denial first: it is a subclass, so the generic catch below would otherwise swallow it
    // and report a scoping refusal as a malformed payload.
    if (error instanceof BankSanctionBranchError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof BankSanctionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('DELETE /api/bank-sanctions/[id] failed:', error)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }
}
