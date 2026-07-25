import 'server-only'

import { sendEmail } from '@/lib/email/email-service'
import { detailTable, emailLayout } from '@/lib/email/templates/layout'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type PettyCashApprovalEmailOptions = {
  requestNumber: string
  requestedByName: string
  requestedByEmail?: string | null
  createdByUserId: string
  requestedAmount: string | number
  allocatedAmount?: string | number | null
  purpose: string
  stage: 'ed_approval' | 'ea_approval' | 'md_approval' | 'accounts'
  action: 'approve' | 'hold' | 'reject'
  approvedByName: string
  approvedByRole: string
  newStatus: string
  remarks?: string | null
}

const STAGE_TITLE_MAP: Record<string, string> = {
  ed_approval: 'ED Approval (Executive Director)',
  ea_approval: 'EA Approval (Executive Assistant)',
  md_approval: 'MD Approval (Managing Director)',
  accounts: 'Accounts Approval (Final)',
}

function formatAmount(value: string | number | null | undefined) {
  const amt = Number(value || 0)
  return `Rs ${Math.round(amt).toLocaleString('en-IN')}`
}

export async function sendPettyCashApprovalEmail(opts: PettyCashApprovalEmailOptions) {
  try {
    let recipientEmail = opts.requestedByEmail
    if (!recipientEmail && opts.createdByUserId) {
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, opts.createdByUserId)).limit(1)
      if (u?.email) recipientEmail = u.email
    }

    if (!recipientEmail || !recipientEmail.includes('@')) {
      console.warn('[petty-cash-email] No recipient email found for request', opts.requestNumber)
      return
    }

    const stageLabel = STAGE_TITLE_MAP[opts.stage] || opts.stage
    const isFinal = opts.stage === 'accounts' && opts.action === 'approve'

    const subject = isFinal
      ? `Petty Cash #${opts.requestNumber} - Final Approved & Allocated`
      : `Petty Cash #${opts.requestNumber} Approved at ${stageLabel}`

    const eyebrow = isFinal ? 'Petty Cash Final Approval' : 'Petty Cash Stage Update'
    const heading = isFinal
      ? `Your Petty Cash Request #${opts.requestNumber} is Approved!`
      : `Stage Approved: ${stageLabel}`

    const bodyHtml = `
      <p style="margin:0 0 16px;">Dear <strong>${opts.requestedByName}</strong>,</p>
      <p style="margin:0 0 16px;">
        ${isFinal
          ? `Great news! Your petty cash request <strong>#${opts.requestNumber}</strong> has received final approval from Accounts and has been allocated to your active balance.`
          : `Your petty cash request <strong>#${opts.requestNumber}</strong> has been approved at the <strong>${stageLabel}</strong> stage by <strong>${opts.approvedByName}</strong>.`
        }
      </p>

      ${detailTable([
        ['Request Number', opts.requestNumber],
        ['Requested Amount', formatAmount(opts.requestedAmount)],
        ...(isFinal && opts.allocatedAmount ? [['Allocated Amount', formatAmount(opts.allocatedAmount)] as [string, string]] : []),
        ['Current Stage', stageLabel],
        ['Approved By', `${opts.approvedByName} (${opts.approvedByRole.toUpperCase().replace(/_/g, ' ')})`],
        ['Status', opts.newStatus.replace(/_/g, ' ').toUpperCase()],
        ['Purpose', opts.purpose],
        ...(opts.remarks ? [['Remarks', opts.remarks] as [string, string]] : []),
      ])}

      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
        ${isFinal
          ? 'You can now submit expenses against this allocation directly from your Petty Cash dashboard.'
          : 'Your request will now move to the next stage in the approval workflow.'
        }
      </p>
    `

    const html = emailLayout({
      heading,
      eyebrow,
      bodyHtml,
      brand: 'AM Group Petty Cash',
    })

    await sendEmail({
      to: recipientEmail,
      subject,
      html,
    })
    console.log(`[petty-cash-email] Email sent successfully to ${recipientEmail} for request #${opts.requestNumber}`)
  } catch (err) {
    console.error('[petty-cash-email] Failed to send email notification:', err)
  }
}
