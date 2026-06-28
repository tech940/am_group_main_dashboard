import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { getPettyCashLedger } from '@/lib/petty-cash/server'

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json({
      ledger: await getPettyCashLedger(appUser, request.nextUrl.searchParams.get('allocationId')),
    })
  } catch (error) {
    console.error('GET /api/petty-cash/reports failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
