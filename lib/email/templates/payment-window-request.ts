import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

/**
 * INTERNAL email to the MD — a consultant has asked for extra customer payment time on a car they
 * just allotted.
 *
 * PII-light by the same rule as callback-request.ts: the requesting customer's NAME appears (the MD
 * needs to know whose deal this is) but never phone / email / address. Competing bookings are
 * reported as a COUNT only — naming other customers belongs on the review screen behind the
 * permission gate, not in an inbox.
 */
export type PaymentWindowRequestEmailData = {
  bookingNumber: string
  customerName: string
  model?: string | null
  variant?: string | null
  vinNumber: string
  dealerCode?: string | null
  currentWindowHours: number
  requestedDays: number
  reason: string
  requestedByName: string
  /** Other live bookings that could take this same car. 0 is reported explicitly — it is a decision input. */
  competingBookings: number
  reviewUrl?: string | null
}

function describeWindow(hours: number) {
  if (hours % 24 === 0) {
    const days = hours / 24
    return `${days} day${days === 1 ? '' : 's'} (${hours}h)`
  }
  return `${hours}h`
}

export function paymentWindowRequestSubject(data: Pick<PaymentWindowRequestEmailData, 'requestedDays' | 'bookingNumber' | 'customerName'>) {
  return `Extra payment time requested · ${data.requestedDays} day${data.requestedDays === 1 ? '' : 's'} · ${data.customerName} · ${data.bookingNumber}`
}

export function buildPaymentWindowRequestEmail(data: PaymentWindowRequestEmailData): {
  subject: string
  html: string
  text: string
} {
  const requester = data.requestedByName?.trim() || 'A consultant'
  const vehicle = [data.model, data.variant].filter(Boolean).join(' ') || null
  const competing = data.competingBookings

  const competingLine = competing > 0
    ? `<p style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#fff8e1;border:1px solid #f5d67f;color:#7a5b00;">
         <strong>${competing} other booking${competing === 1 ? '' : 's'}</strong> could take this same car.
         Granting extra time keeps ${competing === 1 ? 'that customer' : 'those customers'} waiting.
       </p>`
    : `<p style="margin:0 0 18px;font-size:13px;color:#5b6472;">No other live booking currently matches this car.</p>`

  const bodyHtml = `
    <p style="margin:0 0 14px;"><strong>${escapeHtml(requester)}</strong> has asked for extra payment time on a vehicle they just allotted.</p>
    <p style="margin:0 0 18px;">The standard window is already running — it is <strong>not</strong> extended unless you approve this.</p>
    ${competingLine}
    ${detailTable([
      ['Booking Number', data.bookingNumber],
      ['Customer', data.customerName],
      ['Vehicle', vehicle],
      ['VIN', data.vinNumber],
      ['Dealer', data.dealerCode],
      ['Current window', describeWindow(data.currentWindowHours)],
      ['Requested window', `${data.requestedDays} day${data.requestedDays === 1 ? '' : 's'}`],
      ['Requested by', requester],
      ['Reason', data.reason],
    ])}
    ${data.reviewUrl ? `
    ${primaryButton(data.reviewUrl, 'Review request')}
    <p style="margin:6px 0 0;text-align:center;font-size:12px;color:#9aa2b1;">You can approve a different number of days, or reject and leave the standard window in place.</p>
    ` : ''}
  `

  const html = emailLayout({
    heading: 'Extra Payment Time Requested',
    eyebrow: 'Needs your approval',
    preheader: `${requester} wants ${data.requestedDays} day${data.requestedDays === 1 ? '' : 's'} for ${data.customerName} · ${data.bookingNumber}`,
    bodyHtml,
  })

  const text = [
    `${requester} has asked for extra payment time on a vehicle they just allotted.`,
    'The standard window is already running — it is NOT extended unless you approve this.',
    '',
    competing > 0
      ? `${competing} other booking${competing === 1 ? '' : 's'} could take this same car.`
      : 'No other live booking currently matches this car.',
    '',
    `Booking Number: ${data.bookingNumber}`,
    `Customer: ${data.customerName}`,
    vehicle ? `Vehicle: ${vehicle}` : '',
    `VIN: ${data.vinNumber}`,
    data.dealerCode ? `Dealer: ${data.dealerCode}` : '',
    `Current window: ${describeWindow(data.currentWindowHours)}`,
    `Requested window: ${data.requestedDays} day${data.requestedDays === 1 ? '' : 's'}`,
    `Requested by: ${requester}`,
    `Reason: ${data.reason}`,
    '',
    data.reviewUrl ? `Review request: ${data.reviewUrl}` : '',
    '',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: paymentWindowRequestSubject(data), html, text }
}
