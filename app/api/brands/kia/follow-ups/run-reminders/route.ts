import { NextResponse } from 'next/server'
import { runFollowupReminders } from '@/lib/kia/followup-reminders'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'

export const dynamic = 'force-dynamic'

// Cron endpoint: emails reminders for follow-ups now due. Idempotent — safe to call as often as
// you like. Accepts `Authorization: Bearer $CRON_SECRET` (the scheduler) or
// `?secret=$FOLLOWUP_REMINDER_SECRET` (manual/n8n).
//
// Was `if (secret && provided !== secret)`, which skipped the check ENTIRELY when the env var was
// unset — leaving an endpoint that emails customers-facing staff open to any anonymous caller.
// authorizeCronRequest fails closed instead.
export async function POST(request: Request) {
  const url = new URL(request.url)
  const auth = authorizeCronRequest(request, url, {
    secret: process.env.FOLLOWUP_REMINDER_SECRET,
    secretEnvName: 'FOLLOWUP_REMINDER_SECRET',
  })
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  try {
    const result = await runFollowupReminders()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Follow-up reminder run failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
