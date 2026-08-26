import 'server-only'

import { env } from '@/config/env-config'
import { getDueFollowupsForReminders, markReminderSent, syncOverdueDeliveryFollowups, type DueFollowup } from '@/lib/kia/lead-followups'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout, detailTable, primaryButton, escapeHtml } from '@/lib/email/templates/layout'
import { formatIstDateTime } from '@/lib/date-time'

const FOLLOWUPS_URL = `${String(env.app.url || '').replace(/\/$/, '')}/brands/kia/follow-ups`
const REASON_LABEL: Record<string, string> = {
  callback: 'Callback', payment_pending: 'Payment pending', document_pending: 'Documents', delivery: 'Delivery', general: 'General',
}

// Runs the follow-up reminder sweep: for every pending follow-up now due (and not yet reminded), send
// the assignee one digest email. Idempotent via reminder_sent_at. Content is PII-free (customer name +
// model + booking number only — never the phone).
// (The in-app notification half was removed with the notification system; email is the only channel.)
export async function runFollowupReminders(): Promise<{ due: number; emailed: number }> {
  // Ensure any 15+ day undelivered bookings are enqueued before compiling reminders
  await syncOverdueDeliveryFollowups().catch(() => {})

  const due = await getDueFollowupsForReminders()
  if (!due.length) return { due: 0, emailed: 0 }

  // One digest email per assignee (grouped by email).
  const byEmail = new Map<string, DueFollowup[]>()
  for (const f of due) {
    const email = String(f.assignedEmail || '').trim()
    if (!email) continue
    ;(byEmail.get(email) || byEmail.set(email, []).get(email)!).push(f)
  }
  let emailed = 0
  for (const [email, items] of byEmail) {
    try {
      await sendEmail({ to: email, subject: `${items.length} KIA follow-up${items.length > 1 ? 's' : ''} due`, html: digestHtml(items) })
      emailed++
    } catch (error) {
      console.error('[followup-reminders] email failed for', email, error)
    }
  }

  // Mark ALL processed due follow-ups as reminded (even unassigned) so they aren't reprocessed.
  await markReminderSent(due.map((f) => f.id))
  return { due: due.length, emailed }
}

function digestHtml(items: DueFollowup[]): string {
  const name = items[0]?.assignedName || 'there'
  const rows = items
    .map((f) => detailTable([
      ['Customer', f.customerName],
      ['Vehicle', f.model || '—'],
      ['Booking', f.bookingNumber || '—'],
      ['Reason', REASON_LABEL[f.reason] || f.reason],
      /*
        * ⚠️ IST, explicitly, and labelled as such in the email body.
        *
        * This ran on the server with no timeZone, and the server clock is UTC in production — so
        * every reminder ever sent announced a due time 5h30m EARLIER than the real one. A follow-up
        * genuinely due at 10:00 am was emailed to staff as "04:30 am".
        */
      ['Due', formatIstDateTime(f.dueAt)],
    ]))
    .join('<div style="height:12px"></div>')
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(name)}, these follow-ups are due. Please action them from the pipeline.</p>
    ${rows}
    <div style="height:20px"></div>
    ${primaryButton(FOLLOWUPS_URL, 'Open Follow-ups')}
  `
  return emailLayout({ heading: 'Follow-ups due', eyebrow: 'AM Kia · Sales', preheader: `${items.length} follow-up(s) need your attention`, bodyHtml })
}
