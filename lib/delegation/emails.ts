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
  isReminder?: boolean
  isReassign?: boolean
}): Promise<boolean> {
  const to = String(input.toEmail || '').trim()
  if (!to) return false
  const cc = (input.cc ?? []).map((e) => String(e || '').trim()).filter(Boolean)
  const due = input.dueAt ? (input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt) : null

  let greetingText = `Hi ${escapeHtml(input.toName || 'there')}, ${escapeHtml(input.assignerName)} has delegated a task to you.`
  if (input.isUpdate) {
    greetingText = `Hi ${escapeHtml(input.toName || 'there')}, the details for a task delegated to you by ${escapeHtml(input.assignerName)} have been updated.`
  } else if (input.isReminder) {
    greetingText = `Hi ${escapeHtml(input.toName || 'there')}, this is a gentle reminder regarding the task delegated to you by ${escapeHtml(input.assignerName)}.`
  } else if (input.isReassign) {
    greetingText = `Hi ${escapeHtml(input.toName || 'there')}, the due date/follow-up date for a task delegated to you by ${escapeHtml(input.assignerName)} have been rescheduled.`
  }

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#334155">${greetingText}</p>
    ${detailTable([
      ['Task', input.title],
      ['Due', fmtDate(due)],
    ])}
    
    ${input.description ? `
      <div style="margin-top:20px;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#9aa2b1;">Task Details / विवरण</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;text-align:left;">${escapeHtml(input.description)}</p>
      </div>
    ` : ''}
  `
  try {
    let subject = `New task assigned: ${input.title}`
    let heading = 'A task was delegated to you'
    if (input.isUpdate) {
      subject = `Updated task details: ${input.title}`
      heading = 'Task details were updated'
    } else if (input.isReminder) {
      subject = `Task Reminder: ${input.title}`
      heading = 'Task Reminder / अनुस्मारक'
    } else if (input.isReassign) {
      subject = `Task Rescheduled: ${input.title}`
      heading = 'Task Rescheduled / अनुसूची'
    }

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
      await sendEmail({ to: email, subject: `Daily Reminder: ${items.length} Pending Task${items.length > 1 ? 's' : ''}`, html: digestHtml(items) })
      emailed++
    } catch (error) {
      console.error('[delegation-reminders] email failed for', email, error)
    }
  }

  await markDelegationRemindersSent(due.map((t) => t.id))
  return { due: due.length, emailed }
}

function digestHtml(items: DueTask[]): string {
  const name = items[0]?.assignedName || 'there'
  const rows = items
    .map((t) => {
      const details: [string, string][] = [
        ['Task Title', t.title],
        ['Status', t.status === 'in_progress' ? 'In Progress' : 'Pending / Assigned'],
        ['Priority', PRIORITY_LABEL[t.priority] || 'Normal'],
        ['Due Date', t.dueAt ? fmtDate(t.dueAt) : 'No Deadline Set'],
      ]
      if (t.description) {
        details.push(['Details', t.description])
      }
      return detailTable(details)
    })
    .join('<div style="height:14px"></div>')

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.5;">
      Here is your daily <strong>9:30 AM</strong> morning digest of pending delegated task(s). You will receive this daily summary every morning until your open tasks are marked <strong>Done</strong>.
    </p>

    ${rows}

    ${primaryButton('Open Delegation Tasks Board', TASKS_URL)}

    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.4;text-align:center;">
      Please mark tasks complete on the dashboard once done to stop further morning reminders.
    </p>
  `
  return emailLayout({
    heading: 'Daily Pending Tasks Reminder',
    eyebrow: 'AM Group · Delegation Tasks (9:30 AM Digest)',
    preheader: `${items.length} pending task(s) require your attention`,
    bodyHtml,
  })
}
