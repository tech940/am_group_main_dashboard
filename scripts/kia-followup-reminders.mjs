// Triggers the KIA follow-up reminder sweep (in-app notifications + per-assignee email digest) by
// calling the app's secret-gated cron endpoint. Idempotent (reminder_sent_at + notification dedupe),
// so it is safe to run on any interval. Intended for a daily/hourly schedule (see the scheduler
// sibling) or wired into n8n. Env: NEXT_PUBLIC_APP_URL (or FOLLOWUP_REMINDER_URL), FOLLOWUP_REMINDER_SECRET.
import 'dotenv/config'

async function main() {
  const base = (process.env.FOLLOWUP_REMINDER_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const secret = process.env.FOLLOWUP_REMINDER_SECRET
  const url = `${base}/api/brands/kia/follow-ups/run-reminders${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`
  const res = await fetch(url, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`[followup-reminders] HTTP ${res.status}`, body)
    process.exit(1)
  }
  console.log(`[followup-reminders] due=${body.due ?? 0} notified=${body.notified ?? 0} emailed=${body.emailed ?? 0}`)
}

main().catch((error) => { console.error('kia-followup-reminders failed:', error); process.exit(1) })
