import { NextResponse } from 'next/server'
import { buildGuardView } from '@/lib/gate-pass/guard-view'
import { verifyGateToken } from '@/lib/gate-pass/token'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC endpoint — no login, by design. Security guards have no dashboard accounts.
 *
 * The HMAC token is the credential and resolves to exactly one pass; it cannot be forged and the id
 * space cannot be walked. The response is built from an explicit allowlist in buildGuardView, so a
 * leaked link exposes what a guard at a barrier needs and nothing else.
 *
 * Same construction and same posture as app/api/track/[token]/callback/route.ts.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = verifyGateToken(token, new Date())

  if (!verified.ok) {
    // One generic message regardless of reason. Telling a caller whether a signature was wrong or
    // merely expired hands them a way to probe; the specific reason is for our logs.
    console.warn(`Gate token rejected: ${verified.reason}`)
    return NextResponse.json({ error: 'This gate pass link is not valid.' }, { status: 404 })
  }

  const view = await buildGuardView(verified.passId, verified.purpose)
  if (!view) return NextResponse.json({ error: 'This gate pass link is not valid.' }, { status: 404 })

  return NextResponse.json({ pass: view }, { headers: { 'Cache-Control': 'no-store' } })
}
