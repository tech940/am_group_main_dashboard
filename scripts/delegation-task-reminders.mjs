// Triggers the Delegation Tasks reminder sweep (per-assignee email digest for tasks now due) by
// calling the app's secret-gated cron endpoint. Idempotent (reminder_sent_at), so safe to run on any
// interval.
//
// Auth: prefers `Authorization: Bearer $CRON_SECRET` (the shared cron secret — keeps the secret out
// of URLs/access logs), and falls back to `?secret=$DELEGATION_REMINDER_SECRET` (per-job) if that is
// the one configured. The endpoint's authorizeCronRequest accepts either and FAILS CLOSED if neither
// is set. Env: NEXT_PUBLIC_APP_URL (or DELEGATION_REMINDER_URL); CRON_SECRET or DELEGATION_REMINDER_SECRET.
import 'dotenv/config'

async function main() {
  const base = (process.env.DELEGATION_REMINDER_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const cronSecret = process.env.CRON_SECRET
  const jobSecret = process.env.DELEGATION_REMINDER_SECRET

  const headers = {}
  let query = ''
  if (cronSecret) headers.Authorization = `Bearer ${cronSecret}`
  else if (jobSecret) query = `?secret=${encodeURIComponent(jobSecret)}`

  const res = await fetch(`${base}/api/delegation-tasks/run-reminders${query}`, { method: 'POST', headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`[delegation-reminders] HTTP ${res.status}`, body)
    process.exit(1)
  }
  console.log(`[delegation-reminders] due=${body.due ?? 0} emailed=${body.emailed ?? 0}`)
}

main().catch((error) => { console.error('delegation-task-reminders failed:', error); process.exit(1) })
