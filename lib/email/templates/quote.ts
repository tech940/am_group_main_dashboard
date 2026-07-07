import { emailLayout, escapeHtml } from './layout'

export type QuoteEmailData = {
  customerName?: string | null
}

export const QUOTE_SUBJECT = 'Your Requested Vehicle Quote'

export function buildQuoteEmail(data: QuoteEmailData = {}): {
  subject: string
  html: string
  text: string
} {
  const greeting = data.customerName?.trim() ? escapeHtml(data.customerName.trim()) : 'Customer'

  const bodyHtml = `
    <p style="margin:0 0 14px;">Dear ${greeting},</p>
    <p style="margin:0 0 14px;">Thank you for your interest in a Kia vehicle. Your requested quotation is <strong style="color:#111827;">attached as a PDF</strong>.</p>
    <p style="margin:0 0 14px;">Take a moment to review the pricing and details — and when you&rsquo;re ready, our sales team will be glad to help you take the next step.</p>
    <p style="margin:0;">For any clarification, simply reach out to your sales consultant.</p>
  `

  const html = emailLayout({
    heading: 'Your Vehicle Quote',
    eyebrow: 'Quotation',
    preheader: 'Your requested vehicle quotation is attached.',
    bodyHtml,
  })

  const text = [
    `Dear ${data.customerName?.trim() || 'Customer'},`,
    '',
    'Thank you for your interest.',
    '',
    'Please find your requested quotation attached as a PDF.',
    '',
    'For any clarification, please contact our sales team.',
    '',
    'Regards',
    'AM Kia',
  ].join('\n')

  return { subject: QUOTE_SUBJECT, html, text }
}
