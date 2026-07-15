import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

// INTERNAL staff email — sent when a customer taps "Request a Callback" on their tracking page.
// Deliberately PII-FREE (customer name + booking number + model only, never phone / email / address),
// mirroring the callback notification it replaces. Staff open the booking in the dashboard, where the
// customer's contact details stay behind the normal PII masking rules.
export type CallbackRequestEmailData = {
  customerName: string
  bookingNumber: string
  model?: string | null
  preferredTime?: string | null
  note?: string | null
  dealerCode?: string | null
  bookingUrl?: string | null
}

const PREFERRED_TIME_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  anytime: 'Anytime',
}

export function callbackRequestSubject(data: Pick<CallbackRequestEmailData, 'customerName' | 'bookingNumber'>) {
  return `Callback requested · ${data.customerName} · ${data.bookingNumber}`
}

export function buildCallbackRequestEmail(data: CallbackRequestEmailData): {
  subject: string
  html: string
  text: string
} {
  const customer = data.customerName?.trim() || 'A customer'
  const preferred = data.preferredTime ? (PREFERRED_TIME_LABELS[data.preferredTime] || data.preferredTime) : null

  const bodyHtml = `
    <p style="margin:0 0 14px;"><strong>${escapeHtml(customer)}</strong> has requested a callback.</p>
    <p style="margin:0 0 18px;">Please get in touch with the customer${preferred ? ` — they prefer to be called in the <strong>${escapeHtml(preferred.toLowerCase())}</strong>` : ''}.</p>
    ${detailTable([
      ['Customer', customer],
      ['Booking Number', data.bookingNumber],
      ['Vehicle Model', data.model],
      ['Preferred Time', preferred],
      ['Dealer', data.dealerCode],
      ['Customer Note', data.note],
    ])}
    ${data.bookingUrl ? `
    ${primaryButton(data.bookingUrl, 'Open booking')}
    <p style="margin:6px 0 0;text-align:center;font-size:12px;color:#9aa2b1;">Open the booking in the dashboard for the customer's contact details.</p>
    ` : ''}
  `

  const html = emailLayout({
    heading: 'Callback Requested',
    eyebrow: 'Customer Request',
    preheader: `${customer} requested a callback · ${data.bookingNumber}`,
    bodyHtml,
  })

  const text = [
    `${customer} has requested a callback.`,
    '',
    `Customer: ${customer}`,
    `Booking Number: ${data.bookingNumber}`,
    data.model ? `Vehicle Model: ${data.model}` : '',
    preferred ? `Preferred Time: ${preferred}` : '',
    data.dealerCode ? `Dealer: ${data.dealerCode}` : '',
    data.note ? `Customer Note: ${data.note}` : '',
    '',
    data.bookingUrl ? `Open booking: ${data.bookingUrl}` : '',
    "Open the booking in the dashboard for the customer's contact details.",
    '',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: callbackRequestSubject(data), html, text }
}
