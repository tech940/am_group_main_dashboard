import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'

/** Emails are HTML: vendor names, purposes and MD remarks are free text and must not be raw. */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface MdApprovalEmailParams {
  toEmail: string
  requesterName: string
  vendorName: string
  amount: number | string
  purpose?: string | null
  department?: string | null
  approvalType?: string | null
  approvalTime?: Date
  /**
   * The MD's own comment recorded with the approval.
   *
   * ⚠️ This template had NO remarks field at all, so an MD who approved WITH a note sent the
   * requester an email that silently dropped it — 69 live orders carry such a note and not one of
   * them reached the person who raised it. `purpose` is the REQUEST's text, not the MD's.
   */
  remarks?: string | null
}

export async function sendMdApprovalNotificationEmail(params: MdApprovalEmailParams) {
  const {
    toEmail,
    requesterName,
    vendorName,
    amount,
    purpose,
    department,
    approvalType,
    approvalTime = new Date(),
    remarks,
  } = params

  if (!toEmail || !toEmail.includes('@')) {
    console.warn('[md-approval-email] Skipping notification email: invalid or missing recipient email:', toEmail)
    return
  }

  const numericAmount = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/[^0-9.]/g, '')) || 0
  const formattedAmount = isNaN(numericAmount) || numericAmount === 0
    ? `₹${amount}`
    : `₹${numericAmount.toLocaleString('en-IN')}`

  const formattedTime = approvalTime.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const subject = `MD Approved: Payment Order for ${vendorName}`

  const bodyHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
      <p style="margin: 0 0 16px; font-size: 15px; color: #0f172a;">Hi ${escapeHtml(requesterName) || 'there'},</p>
      
      <p style="margin: 0 0 16px; font-size: 15px; color: #334155;">
        Your vendor payment order request for <strong>${escapeHtml(vendorName)}</strong> has been <strong>APPROVED</strong> by the Managing Director (MD) on <strong>${formattedTime}</strong>.
      </p>

      <div style="margin: 20px 0; padding: 20px; border: 1px solid #cbd5e1; border-radius: 16px; background-color: #f8fafc;">
        <h4 style="margin: 0 0 14px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #004e5a; font-weight: 800;">
          Payment Order Summary
        </h4>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #334155;">
          <tr>
            <td style="padding: 6px 0; font-weight: bold; width: 140px; color: #64748b;">Vendor / Beneficiary:</td>
            <td style="padding: 6px 0; font-weight: bold; color: #0f172a;">${escapeHtml(vendorName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Approved Amount:</td>
            <td style="padding: 6px 0; font-weight: 800; color: #059669; font-size: 15px;">${formattedAmount}</td>
          </tr>
          ${department ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Department:</td>
            <td style="padding: 6px 0;">${escapeHtml(department)}</td>
          </tr>` : ''}
          ${approvalType ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Payment Type:</td>
            <td style="padding: 6px 0;">${escapeHtml(approvalType)}</td>
          </tr>` : ''}
          ${purpose ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Purpose / Remarks:</td>
            <td style="padding: 6px 0;">${escapeHtml(purpose)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #64748b;">Approved At:</td>
            <td style="padding: 6px 0; font-weight: bold; color: #004e5a;">${formattedTime}</td>
          </tr>
        </table>
      </div>

      ${remarks && String(remarks).trim() ? `
      <div style="margin: 20px 0; padding: 16px; border: 1px solid #99f6e4; border-radius: 12px; background-color: #f0fdfa;">
        <h4 style="margin: 0 0 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #0f766e; font-weight: 800;">Remarks from the MD:</h4>
        <p style="margin: 0; font-size: 14px; color: #134e4a; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(remarks)}</p>
      </div>` : ''}

      <p style="margin: 16px 0 0; font-size: 13px; color: #64748b;">
        This payment order is now queued for final processing and execution with Accounts.
      </p>
    </div>
  `

  try {
    await sendEmail({
      to: toEmail,
      subject,
      html: emailLayout({
        heading: 'Payment Order Approved by MD',
        eyebrow: 'AM Group · Vendor Payments',
        preheader: `Your payment request for ${vendorName} (${formattedAmount}) was approved by MD at ${formattedTime}`,
        bodyHtml,
      }),
    })
    console.log(`[md-approval-email] Successfully sent MD approval notification to ${toEmail} for vendor ${escapeHtml(vendorName)}`)
  } catch (err) {
    console.error(`[md-approval-email] Failed to send MD approval email to ${toEmail}:`, err)
  }
}
