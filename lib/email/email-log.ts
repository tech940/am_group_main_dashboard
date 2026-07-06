import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaEmailLogs } from '@/lib/db/schema'
import { sendEmail, type SendEmailOptions } from './email-service'

export type TrackedEmailInput = SendEmailOptions & {
  /** Optional booking this email relates to (quotes have none). */
  bookingId?: string | null
  /** Category for reporting, e.g. 'approved_proforma' | 'quote'. */
  emailType?: string | null
}

export type TrackedEmailResult = { ok: boolean; error?: string }

function primaryRecipient(to: string | string[]): string {
  return Array.isArray(to) ? to.join(', ') : to
}

/**
 * Send an email AND record its outcome in `kia_email_logs`. This never throws —
 * it returns `{ ok, error }` so the booking / proforma workflow is never
 * interrupted by an email failure. Failures are logged (row + console).
 */
export async function sendTrackedEmail(input: TrackedEmailInput): Promise<TrackedEmailResult> {
  const recipient = primaryRecipient(input.to)

  let logId: string | null = null
  try {
    const [row] = await db
      .insert(kiaEmailLogs)
      .values({
        bookingId: input.bookingId || null,
        customerEmail: recipient,
        subject: input.subject,
        emailType: input.emailType || null,
        status: 'pending',
      })
      .returning({ id: kiaEmailLogs.id })
    logId = row?.id ?? null
  } catch (error) {
    // Logging must never block sending.
    console.error('[email-log] failed to write pending row', error)
  }

  try {
    await sendEmail(input)
    if (logId) {
      await db
        .update(kiaEmailLogs)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(kiaEmailLogs.id, logId))
        .catch((error) => console.error('[email-log] failed to mark sent', error))
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email error'
    console.error('[email-log] send failed', {
      recipient,
      subject: input.subject,
      bookingId: input.bookingId || null,
      error: message,
      at: new Date().toISOString(),
    })
    try {
      if (logId) {
        await db
          .update(kiaEmailLogs)
          .set({ status: 'failed', error: message })
          .where(eq(kiaEmailLogs.id, logId))
      } else {
        await db.insert(kiaEmailLogs).values({
          bookingId: input.bookingId || null,
          customerEmail: recipient,
          subject: input.subject,
          emailType: input.emailType || null,
          status: 'failed',
          error: message,
        })
      }
    } catch (logError) {
      console.error('[email-log] failed to record failure', logError)
    }
    return { ok: false, error: message }
  }
}
