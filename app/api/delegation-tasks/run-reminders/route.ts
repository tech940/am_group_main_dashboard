import { NextResponse } from 'next/server'
import { runDelegationTaskReminders } from '@/lib/delegation/emails'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'

export const dynamic = 'force-dynamic'

// Cron endpoint: emails per-assignee digests for delegation tasks now due. Idempotent
// (reminder_sent_at), so safe to call on any interval. Accepts `Authorization: Bearer $CRON_SECRET`
// (the scheduler) or `?secret=$DELEGATION_REMINDER_SECRET` (manual / n8n). authorizeCronRequest FAILS
// CLOSED — an unconfigured secret refuses to run rather than exposing the endpoint.
async function handleRunReminders(request: Request) {
  const url = new URL(request.url)
  const auth = authorizeCronRequest(request, url, {
    secret: process.env.DELEGATION_REMINDER_SECRET,
    secretEnvName: 'DELEGATION_REMINDER_SECRET',
  })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const result = await runDelegationTaskReminders()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Delegation reminder run failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handleRunReminders(request)
}

export async function POST(request: Request) {
  return handleRunReminders(request)
}
