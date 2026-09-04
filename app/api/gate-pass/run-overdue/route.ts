import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import { runOverdueSweep } from '@/lib/gate-pass/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The overdue sweep: mail once per late vehicle, and close passes approved but never driven out.
 *
 * ⚠️ authorizeCronRequest FAILS CLOSED — it returns 503 when neither CRON_SECRET nor the job secret
 * is configured, rather than running. The shape it replaced was `if (secret && provided !== secret)`,
 * which skipped the check entirely whenever the env var was unset and left a DB-write sweep open to
 * anonymous callers on the public internet. Verified live at the time: it returned 200.
 *
 * Both GET and POST, because Vercel Cron issues GET while the npm runners and manual curl use POST.
 */
async function run(request: NextRequest) {
  const auth = authorizeCronRequest(request, request.nextUrl, {
    secret: process.env.GATE_PASS_REMINDER_SECRET,
    secretEnvName: 'GATE_PASS_REMINDER_SECRET',
  })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const result = await runOverdueSweep(new Date())
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Gate pass overdue sweep failed:', error)
    return NextResponse.json({ error: 'Sweep failed.' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
