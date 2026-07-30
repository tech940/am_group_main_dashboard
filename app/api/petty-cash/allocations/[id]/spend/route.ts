import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { getPettyCashAllocationSpend } from '@/lib/petty-cash/server'

export const dynamic = 'force-dynamic'

/**
 * Day-by-day spend against one allocation. Read-only.
 *
 * The reader re-checks the caller's allocation visibility filter and throws 'Forbidden' for an
 * allocation they could not already list, so the id in the URL cannot be used to reach another
 * branch's float.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    return NextResponse.json(await getPettyCashAllocationSpend(appUser, id))
  } catch (error) {
    console.error('GET /api/petty-cash/allocations/[id]/spend failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
