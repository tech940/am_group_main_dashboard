import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { getPettyCashApprovalCount, getPettyCashApprovalQueue } from '@/lib/petty-cash/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser || !canAccessPettyCash(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
