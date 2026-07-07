import { detailTable, emailLayout, escapeHtml } from './layout'

export type ApprovedProformaEmailData = {
  customerName: string
  proformaNumber: string
  model: string
  variant?: string | null
  color?: string | null
  bookingDate?: string | null
  consultantName?: string | null
  dealerName?: string | null
}

export const APPROVED_PROFORMA_SUBJECT = 'Your Kia Proforma has been Approved'

export function buildApprovedProformaEmail(data: ApprovedProformaEmailData): {
  subject: string
  html: string
  text: string
} {
  const greetingName = data.customerName?.trim() || 'Customer'

  const bodyHtml = `
    <p style="margin:0 0 16px;">Dear <strong>${escapeHtml(greetingName)}</strong>,</p>
    <p style="margin:0 0 16px;">We are pleased to inform you that your vehicle proforma has been approved.</p>
    ${detailTable([
      ['Proforma Number', data.proformaNumber],
      ['Vehicle Model', data.model],
      ['Variant', data.variant],
      ['Color', data.color],
      ['Booking Date', data.bookingDate],
      ['Consultant', data.consultantName],
      ['Dealer', data.dealerName],
    ])}
    <p style="margin:16px 0 0;">Our team will now proceed with the remaining booking process.</p>
    <p style="margin:12px 0 0;">If you have any questions, please contact your sales consultant.</p>
  `

  const html = emailLayout({
    heading: 'Proforma Approved',
    preheader: 'Your Kia vehicle proforma has been approved.',
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
    'Our team will now proceed with the remaining booking process.',
    'If you have any questions, please contact your sales consultant.',
    '',
    'Regards,',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: APPROVED_PROFORMA_SUBJECT, html, text }
}
