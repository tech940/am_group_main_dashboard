import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { getPettyCashStatusBoard } from '@/lib/petty-cash/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json(await getPettyCashStatusBoard(appUser))
  } catch (error) {
    console.error('GET /api/petty-cash/status failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load petty cash status board.'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
