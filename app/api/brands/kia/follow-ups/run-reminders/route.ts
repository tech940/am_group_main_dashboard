import { NextResponse } from 'next/server'
import { runFollowupReminders } from '@/lib/kia/followup-reminders'

export const dynamic = 'force-dynamic'

// Cron endpoint: emails reminders for follow-ups now due. Secret-gated (?secret=) so the scheduler
// (or n8n) can call it. Idempotent — safe to call as often as you like.
export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.FOLLOWUP_REMINDER_SECRET
  if (secret && url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const result = await runFollowupReminders()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Follow-up reminder run failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
