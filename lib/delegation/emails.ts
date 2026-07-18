import 'server-only'

import { env } from '@/config/env-config'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout, detailTable, primaryButton, escapeHtml } from '@/lib/email/templates/layout'
import { getDueDelegationTasks, markDelegationRemindersSent, type DueTask } from '@/lib/delegation/tasks'

// Email is the ONLY notification channel — the in-app notification system was removed. For a
// delegation tool that matters more than usual: with no bell, the assignee learns they have a task
// from the assignment email, and is nudged again by the due-reminder sweep.

const TASKS_URL = `${String(env.app.url || '').replace(/\/$/, '')}/delegation-tasks`
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High' }
const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No due date'

// ── Assignment notification ──────────────────────────────────────────────────────────────────────
// Sent when a task is created or reassigned. Called AFTER the DB transaction commits and awaited
// best-effort by the API route (never inside the write path, and a mail failure must not fail the
// task) — a fire-and-forget send would be unreliable on Vercel, where the instance freezes after the
// response.
export async function sendTaskAssignedEmail(input: {
  toEmail: string | null | undefined
  toName: string | null | undefined
  assignerName: string
  title: string
  description?: string | null
  dueAt?: string | Date | null
  priority: string
  cc?: string[]
  isUpdate?: boolean
}): Promise<boolean> {
  const to = String(input.toEmail || '').trim()
  if (!to) return false
  const cc = (input.cc ?? []).map((e) => String(e || '').trim()).filter(Boolean)
  const due = input.dueAt ? (input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt) : null

  const greetingText = input.isUpdate
    ? `Hi ${escapeHtml(input.toName || 'there')}, the details for a task delegated to you by ${escapeHtml(input.assignerName)} have been updated.`
    : `Hi ${escapeHtml(input.toName || 'there')}, ${escapeHtml(input.assignerName)} has delegated a task to you.`

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#334155">${greetingText}</p>
    ${detailTable([
      ['Task', input.title],
      ['Priority', PRIORITY_LABEL[input.priority] || input.priority],
      ['Due', fmtDate(due)],
    ])}
    
    ${input.description ? `
      <div style="margin-top:20px;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#9aa2b1;">Task Details / विवरण</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;text-align:left;">${escapeHtml(input.description)}</p>
      </div>
    ` : ''}

    <div style="height:20px"></div>
    ${primaryButton(TASKS_URL, 'Open Delegation Tasks')}
  `
  try {
    const subject = input.isUpdate ? `Updated task details: ${input.title}` : `New task assigned: ${input.title}`
    const heading = input.isUpdate ? 'Task details were updated' : 'A task was delegated to you'
    await sendEmail({
      to,
      ...(cc.length ? { cc } : {}),
      subject,
      html: emailLayout({ heading, eyebrow: 'AM Group · Tasks', preheader: input.title, bodyHtml }),
    })
    return true
  } catch (error) {
    console.error('[delegation] assignment email failed for', to, error)
    return false
  }
}

// ── Due / overdue reminder sweep ──────────────────────────────────────────────────────────────────
// One digest email per assignee for their open, now-due tasks. Idempotent via reminder_sent_at (which
// is re-armed on reopen / reassign / due-date change). Safe to run on any interval.
export async function runDelegationTaskReminders(): Promise<{ due: number; emailed: number }> {
  const due = await getDueDelegationTasks()
  if (!due.length) return { due: 0, emailed: 0 }

  const byEmail = new Map<string, DueTask[]>()
  for (const t of due) {
    const email = String(t.assignedEmail || '').trim()
    if (!email) continue
    ;(byEmail.get(email) || byEmail.set(email, []).get(email)!).push(t)
  }

  let emailed = 0
  for (const [email, items] of byEmail) {
    try {
      await sendEmail({ to: email, subject: `${items.length} task${items.length > 1 ? 's' : ''} due`, html: digestHtml(items) })
      emailed++
    } catch (error) {
      console.error('[delegation-reminders] email failed for', email, error)
    }
  }

  // Mark ALL processed due tasks reminded (even any with no assignee email) so they aren't reprocessed.
  await markDelegationRemindersSent(due.map((t) => t.id))
  return { due: due.length, emailed }
}

function digestHtml(items: DueTask[]): string {
  const name = items[0]?.assignedName || 'there'
  const rows = items
    .map((t) => detailTable([
      ['Task', t.title],
      ['Priority', PRIORITY_LABEL[t.priority] || t.priority],
      ['Due', fmtDate(t.dueAt)],
    ]))
    .join('<div style="height:12px"></div>')
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${escapeHtml(name)}, these delegated tasks are due. Please action them.</p>
    ${rows}
    <div style="height:20px"></div>
    ${primaryButton(TASKS_URL, 'Open Delegation Tasks')}
  `
  return emailLayout({ heading: 'Tasks due', eyebrow: 'AM Group · Tasks', preheader: `${items.length} task(s) need your attention`, bodyHtml })
}
