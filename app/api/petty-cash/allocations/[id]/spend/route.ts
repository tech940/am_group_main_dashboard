import { NextResponse } from 'next/server'
import { getPettyCashAllocationSpend } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

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
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const { id } = await params
    return NextResponse.json(await getPettyCashAllocationSpend(appUser, id))
  } catch (error) {
    console.error('GET /api/petty-cash/allocations/[id]/spend failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
