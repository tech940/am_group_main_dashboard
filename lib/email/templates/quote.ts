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
    <p style="margin:0 0 16px;">Dear ${greeting},</p>
    <p style="margin:0 0 16px;">Thank you for your interest.</p>
    <p style="margin:0 0 16px;">Please find your requested quotation attached as a PDF.</p>
    <p style="margin:0;">For any clarification, please contact our sales team.</p>
  `

  const html = emailLayout({
    heading: 'Your Vehicle Quote',
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
