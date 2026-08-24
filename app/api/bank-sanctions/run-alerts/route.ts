import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import { runBankSanctionExpiryAlerts } from '@/lib/bank-sanctions/expiry-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron endpoint: emails each alert address its expired / expiring-this-month facilities, CCing the
 * accounts default. Replaces the Apps Script's 15-day time trigger — crons in this repo are
 * EXTERNAL (the kia-maintenance pattern), so an outside scheduler must hit this every 15 days:
 *
 *   POST /api/bank-sanctions/run-alerts?secret=$BANK_SANCTION_ALERT_SECRET
 *
 * authorizeCronRequest FAILS CLOSED: with no secret configured the endpoint refuses to run rather
 * than being open. Idempotence is inherent — the digest describes current state, so a double fire
 * sends the same email twice and nothing worse.
 */
async function handleRunAlerts(request: Request) {
  const url = new URL(request.url)
  const auth = authorizeCronRequest(request, url, {
    secret: process.env.BANK_SANCTION_ALERT_SECRET,
    secretEnvName: 'BANK_SANCTION_ALERT_SECRET',
  })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const result = await runBankSanctionExpiryAlerts()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Bank sanction alert run failed:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  return handleRunAlerts(request)
}

export async function POST(request: Request) {
  return handleRunAlerts(request)
}
