import { NextResponse } from 'next/server'
import { getPettyCashApprovalCount, getPettyCashApprovalQueue } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const url = new URL(request.url)

    // Lightweight path for the live badge count (no rows shipped).
    if (url.searchParams.get('countOnly') === '1') {
      const count = await getPettyCashApprovalCount(appUser)
      return NextResponse.json({ count })
    }

    const result = await getPettyCashApprovalQueue(appUser, {
      search: url.searchParams.get('search'),
      branchId: url.searchParams.get('branchId'),
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/petty-cash/approvals failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load petty cash approvals.'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
