import 'server-only'

import { env } from '@/config/env-config'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout, detailTable, primaryButton, escapeHtml } from '@/lib/email/templates/layout'
import { getDueDelegationTasks, markDelegationRemindersSent, type DueTask } from '@/lib/delegation/tasks'

// Email is the ONLY notification channel — the in-app notification system was removed. For a
// delegation tool that matters more than usual: with no bell, the assignee learns they have a task
// from the assignment email, and is nudged again by the due-reminder sweep.

function getTasksUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` :
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : env.app.url || 'http://localhost:3000'))
  return `${String(baseUrl).replace(/\/$/, '')}/delegation-tasks`
}
const PRIORITY_LABEL: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High' }
const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No due date'

// ── Assignment notification ──────────────────────────────────────────────────────────────────────
// Sent when a task is created or reassigned. Called AFTER the DB transaction commits and awaited
// best-effort by the API route (never inside the write path, and a mail failure must not fail the
// task) — a fire-and-forget send would be unreliable on Vercel, where the instance freezes after the
// response.
/**
 * Work out who is on a task email — extracted so it can be TESTED WITHOUT SENDING.
 *
 * ⚠️ Verify recipient logic through THIS function, never by calling sendTaskAssignedEmail with
 * sample data. `sendEmail` is a real SMTP send: an ES module export cannot be monkey-patched at
 * runtime (the binding is read-only, the assignment silently no-ops), so a "mock" in a scratch
 * script mails actual people. That mistake has already been made once against live addresses.
 *
 * Returns the Cc list and the Reply-To to use. Both matter and neither is sufficient alone:
 * Cc gives the delegator a copy of what was sent, Reply-To makes the assignee's reply reach them
 * instead of the tech@ mailbox these messages are sent from.
 */
export function buildTaskEmailRecipients(input: {
  toEmail: string
  assignerEmail?: string | null
  cc?: string[]
}): { assignerEmail: string; cc: string[] } {
  const to = String(input.toEmail || '').trim().toLowerCase()
  const assignerEmail = String(input.assignerEmail || '').trim()
  const list = (input.cc ?? []).map((e) => String(e || '').trim()).filter(Boolean)
  if (assignerEmail) list.push(assignerEmail)
  // Never Cc the recipient back to themselves — a self-delegated task would otherwise arrive twice.
  const cc = Array.from(new Set(list.map((e) => e.toLowerCase()))).filter((e) => e !== to)
  return { assignerEmail, cc }
}

export async function sendTaskAssignedEmail(input: {
  toEmail: string | null | undefined
  toName: string | null | undefined
  assignerName: string
  /**
   * The delegator's own address. When present they are CC'd and set as Reply-To — see the note in
   * the body of this function. Optional so existing callers keep compiling, but every caller that
   * knows who delegated SHOULD pass it.
   */
  assignerEmail?: string | null
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

  /*
   * ── Keep the delegator in the conversation ───────────────────────────────────────────────────
   *
   * These mails leave as tech@amgroupind.com. The delegator was on neither the To nor the Cc line,
   * so when the assignee replied "done" it reached a mailbox nobody in the conversation reads, and
   * the person who asked for the work never heard back. The body even told people to "inform the
   * concerned EA" out of band — because replying could not possibly work.
   *
   * Cc puts the delegator on the thread; replyTo makes the assignee's Reply reach them instead of
   * the sending mailbox. BOTH are needed: Cc alone still sends the reply to tech@, and replyTo alone
   * leaves the delegator without a copy of what was actually sent.
   */
  const { assignerEmail, cc } = buildTaskEmailRecipients({
    toEmail: to,
    assignerEmail: input.assignerEmail,
    cc: input.cc,
  })
  const replyLine = assignerEmail
    ? `<p style="margin:0 0 8px;"><strong>Reply to this email</strong> once the task is done — your reply goes straight to ${escapeHtml(input.assignerName)}, who is copied here.</p>
       <p style="margin:0;">Need more time? Reply before the due date with the reason and a revised completion date.</p>`
    : `<p style="margin:0 0 8px;">Please complete the task by the due date and inform the concerned EA once it is completed.</p>
       <p style="margin:0;">If you require additional time, please contact the concerned EA before the due date, explain the reason for the delay, and provide a revised completion date. The EA will update the task accordingly.</p>`
  const due = input.dueAt ? (input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt) : null
  const tasksUrl = getTasksUrl()

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
        <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#9aa2b1;">Task Details</h4>
        <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;text-align:left;">${escapeHtml(input.description)}</p>
      </div>
    ` : ''}

    <div style="margin-top:20px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;font-size:13px;color:#334155;line-height:1.6;">
      ${replyLine}
    </div>
  `
  try {
    let subject = `New task assigned: ${input.title}`
    let heading = 'A task was delegated to you'
    if (input.isUpdate) {
      subject = `Updated task details: ${input.title}`
      heading = 'Task details were updated'
    } else if (input.isReminder) {
      subject = `Task Reminder: ${input.title}`
      heading = 'Task Reminder'
    } else if (input.isReassign) {
      subject = `Task Rescheduled: ${input.title}`
      heading = 'Task Rescheduled'
    }

    await sendEmail({
      to,
      ...(cc.length ? { cc } : {}),
      ...(assignerEmail ? { replyTo: assignerEmail } : {}),
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
  const successfullySentIds: string[] = []

  for (const [email, items] of byEmail) {
    try {
      // CC only the MD who owns these tasks (first item's mdUserEmail is sufficient since digest is per-assignee)
      const mdEmail = items[0]?.mdUserEmail ? String(items[0].mdUserEmail).trim() : null
      const cc = mdEmail && mdEmail.toLowerCase() !== email.toLowerCase() ? [mdEmail] : undefined

      await sendEmail({
        to: email,
        ...(cc ? { cc } : {}),
        subject: `Daily Reminder: ${items.length} Pending Task${items.length > 1 ? 's' : ''}`,
        html: digestHtml(items),
      })
      emailed++
      successfullySentIds.push(...items.map((i) => i.id))
    } catch (error) {
      console.error('[delegation-reminders] email failed for', email, error)
    }
  }

  if (successfullySentIds.length > 0) {
    await markDelegationRemindersSent(successfullySentIds)
  }
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

    <div style="margin-top:20px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;font-size:13px;color:#334155;line-height:1.6;">
      <p style="margin:0 0 8px;">Please complete the task by the due date and inform the concerned EA once it is completed.</p>
      <p style="margin:0;">If you require additional time, please contact the concerned EA before the due date, explain the reason for the delay, and provide a revised completion date. The EA will update the task accordingly.</p>
    </div>
  `
  return emailLayout({
    heading: 'Daily Pending Tasks Reminder',
    eyebrow: 'AM Group · Delegation Tasks (9:30 AM Digest)',
    preheader: `${items.length} pending task(s) require your attention`,
    bodyHtml,
  })
}
