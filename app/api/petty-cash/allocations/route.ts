import { NextRequest, NextResponse } from 'next/server'
import { listPettyCashAllocations } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    // status=all returns the allocation HISTORY (closed rows included) instead of just the one open
    // float per person. Default stays 'active' so existing callers see no change.
    return NextResponse.json(
      await listPettyCashAllocations(appUser, {
        branchId: request.nextUrl.searchParams.get('branchId'),
        status: request.nextUrl.searchParams.get('status'),
      }),
    )
  } catch (error) {
    console.error('GET /api/petty-cash/allocations failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
