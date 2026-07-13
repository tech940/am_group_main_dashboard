import { detailTable, emailLayout, escapeHtml, primaryButton, secondaryButton } from './layout'
import type { ApprovedProformaEmailData } from './approved-proforma'

// Same fields as the approved-proforma email — sent when a General Sales Manager EDITS an existing
// proforma, so the customer receives the revised details + PDF. (The edited proforma re-enters the
// approval chain, so the copy says "updated", not "approved".)
export type UpdatedProformaEmailData = ApprovedProformaEmailData

export const UPDATED_PROFORMA_SUBJECT = 'Your Kia Proforma has been Updated'

export function buildUpdatedProformaEmail(data: UpdatedProformaEmailData): {
  subject: string
  html: string
  text: string
} {
  const greetingName = data.customerName?.trim() || 'Customer'

  const bodyHtml = `
    <p style="margin:0 0 14px;">Dear <strong>${escapeHtml(greetingName)}</strong>,</p>
    <p style="margin:0 0 18px;">Your vehicle proforma has been <strong style="color:#111827;">updated</strong>. The latest proforma is attached to this email as a PDF for your records.</p>
    ${detailTable([
      ['Proforma Number', data.proformaNumber],
      ['Vehicle Model', data.model],
      ['Variant', data.variant],
      ['Color', data.color],
      ['Booking Date', data.bookingDate],
      ['Consultant', data.consultantName],
      ['Dealer', data.dealerName],
    ])}
    ${data.trackingUrl ? `
    ${primaryButton(data.trackingUrl, 'Track your order')}
    <p style="margin:6px 0 0;text-align:center;font-size:12px;color:#9aa2b1;">Follow your booking status anytime with the button above.</p>
    ` : ''}
    ${data.callbackUrl ? `
    ${secondaryButton(data.callbackUrl, 'Request a Callback')}
    <p style="margin:6px 0 0;text-align:center;font-size:12px;color:#9aa2b1;">Prefer to talk? Tap above and our team will call you back.</p>
    ` : ''}
    <p style="margin:20px 0 0;">Please review the updated details above. If you have any questions, reach out to your sales consultant.</p>
  `

  const html = emailLayout({
    heading: 'Your Proforma has been Updated',
    eyebrow: 'Order Update',
    preheader: 'Your Kia vehicle proforma has been updated — PDF attached.',
    bodyHtml,
  })

  const text = [
    `Dear ${greetingName},`,
    '',
    'Your vehicle proforma has been updated. The latest proforma PDF is attached.',
    '',
    `Proforma Number: ${data.proformaNumber}`,
    `Vehicle Model: ${data.model}`,
    data.variant ? `Variant: ${data.variant}` : '',
    data.color ? `Color: ${data.color}` : '',
    data.bookingDate ? `Booking Date: ${data.bookingDate}` : '',
    data.consultantName ? `Consultant: ${data.consultantName}` : '',
    data.dealerName ? `Dealer: ${data.dealerName}` : '',
    '',
    data.trackingUrl ? `Track your order: ${data.trackingUrl}` : '',
    data.callbackUrl ? `Request a callback: ${data.callbackUrl}` : '',
    'Please review the updated details. If you have any questions, contact your sales consultant.',
    '',
    'Regards,',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: UPDATED_PROFORMA_SUBJECT, html, text }
}
