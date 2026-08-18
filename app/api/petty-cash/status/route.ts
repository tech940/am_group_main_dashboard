import { NextResponse } from 'next/server'
import { getPettyCashStatusBoard } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    return NextResponse.json(await getPettyCashStatusBoard(appUser))
  } catch (error) {
    console.error('GET /api/petty-cash/status failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to load petty cash status board.'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}
