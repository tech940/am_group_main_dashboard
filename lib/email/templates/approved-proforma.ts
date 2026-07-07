import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

export type ApprovedProformaEmailData = {
  customerName: string
  proformaNumber: string
  model: string
  variant?: string | null
  color?: string | null
  bookingDate?: string | null
  consultantName?: string | null
  dealerName?: string | null
  /** Public self-service tracking URL for the customer to follow their order. */
  trackingUrl?: string | null
}

export const APPROVED_PROFORMA_SUBJECT = 'Your Kia Proforma has been Approved'

export function buildApprovedProformaEmail(data: ApprovedProformaEmailData): {
  subject: string
  html: string
  text: string
} {
  const greetingName = data.customerName?.trim() || 'Customer'

  const bodyHtml = `
    <p style="margin:0 0 14px;">Dear <strong>${escapeHtml(greetingName)}</strong>,</p>
    <p style="margin:0 0 18px;">Great news — your vehicle proforma has been <strong style="color:#111827;">approved</strong>. The signed proforma is attached to this email as a PDF for your records.</p>
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
    <p style="margin:20px 0 0;">Our team will now proceed with the remaining booking process. If you have any questions, please reach out to your sales consultant.</p>
  `

  const html = emailLayout({
    heading: 'Your Proforma is Approved',
    eyebrow: 'Order Update',
    preheader: 'Your Kia vehicle proforma has been approved — PDF attached.',
    bodyHtml,
  })

  const text = [
    `Dear ${greetingName},`,
    '',
    'We are pleased to inform you that your vehicle proforma has been approved.',
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
    'Our team will now proceed with the remaining booking process.',
    'If you have any questions, please contact your sales consultant.',
    '',
    'Regards,',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: APPROVED_PROFORMA_SUBJECT, html, text }
}
