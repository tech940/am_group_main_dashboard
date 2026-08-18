import { NextRequest, NextResponse } from 'next/server'
import { getPettyCashLedger } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    return NextResponse.json({
      ledger: await getPettyCashLedger(appUser, request.nextUrl.searchParams.get('allocationId')),
    })
  } catch (error) {
    console.error('GET /api/petty-cash/reports failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
