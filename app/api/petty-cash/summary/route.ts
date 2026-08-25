import { NextRequest, NextResponse } from 'next/server'
import { getPettyCashExpenseSummary } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const branchId = request.nextUrl.searchParams.get('branchId')
    const month = request.nextUrl.searchParams.get('month')

    const summary = await getPettyCashExpenseSummary(appUser, {
      branchId,
      month,
    })

    return NextResponse.json(summary)
  } catch (error) {
    console.error('GET /api/petty-cash/summary failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
