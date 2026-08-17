import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

/**
 * Tells the CONSULTANT what the MD decided about their extra-time request.
 *
 * This direction exists because the comparable discount flow has no decision email at all — the
 * requester has to keep reopening the booking to find out, which is how a granted extension goes
 * unused and a rejected one gets chased.
 */
export type PaymentWindowDecisionEmailData = {
  decision: 'APPROVED' | 'REJECTED'
  bookingNumber: string
  customerName: string
  vinNumber: string
  requestedDays: number
  /** What the MD actually granted. May be fewer than requested. */
  approvedDays?: number | null
  /** The new deadline, or null when the car is still in transit and the clock has not opened. */
  newDeadline?: Date | null
  /** True when the vehicle is in transit, so the window applies from arrival. */
  startsOnArrival?: boolean
  decidedByName: string
  remarks?: string | null
  bookingUrl?: string | null
}

function formatIst(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(date)
}

export function paymentWindowDecisionSubject(data: Pick<PaymentWindowDecisionEmailData, 'decision' | 'bookingNumber' | 'customerName'>) {
  const verb = data.decision === 'APPROVED' ? 'approved' : 'rejected'
  return `Extra payment time ${verb} · ${data.customerName} · ${data.bookingNumber}`
}

export function buildPaymentWindowDecisionEmail(data: PaymentWindowDecisionEmailData): {
  subject: string
  html: string
  text: string
} {
  const approved = data.decision === 'APPROVED'
  const granted = data.approvedDays ?? data.requestedDays
  const adjusted = approved && granted !== data.requestedDays

  const headline = approved
    ? `Your request for extra payment time was <strong>approved</strong>${adjusted ? ` for <strong>${granted} day${granted === 1 ? '' : 's'}</strong> instead of ${data.requestedDays}` : ''}.`
    : 'Your request for extra payment time was <strong>rejected</strong>. The standard payment window still applies.'

  const deadlineLine = approved
    ? (data.startsOnArrival
        ? `<p style="margin:0 0 18px;">The vehicle is still in transit, so the ${granted}-day window will start when it arrives and is marked Free Stock.</p>`
        : data.newDeadline
          ? `<p style="margin:0 0 18px;">Payment is now due by <strong>${escapeHtml(formatIst(data.newDeadline))}</strong>.</p>`
          : '')
    : ''

  const bodyHtml = `
    <p style="margin:0 0 14px;">${headline}</p>
    ${deadlineLine}
    ${detailTable([
      ['Booking Number', data.bookingNumber],
      ['Customer', data.customerName],
      ['VIN', data.vinNumber],
      ['Days requested', `${data.requestedDays}`],
      approved ? ['Days approved', `${granted}`] : ['Outcome', 'Rejected — standard window stands'],
      ['Decided by', data.decidedByName],
      ['Remarks', data.remarks],
    ])}
    ${data.bookingUrl ? primaryButton(data.bookingUrl, 'Open booking') : ''}
  `

  const html = emailLayout({
    heading: approved ? 'Extra Payment Time Approved' : 'Extra Payment Time Rejected',
    eyebrow: 'MD decision',
    preheader: `${approved ? 'Approved' : 'Rejected'} · ${data.customerName} · ${data.bookingNumber}`,
    bodyHtml,
  })

  const text = [
    approved
      ? `Your request for extra payment time was APPROVED${adjusted ? ` for ${granted} days instead of ${data.requestedDays}` : ''}.`
      : 'Your request for extra payment time was REJECTED. The standard payment window still applies.',
    '',
    approved && data.startsOnArrival
      ? `The vehicle is still in transit, so the ${granted}-day window starts when it arrives and is marked Free Stock.`
      : approved && data.newDeadline
        ? `Payment is now due by ${formatIst(data.newDeadline)}.`
        : '',
    '',
    `Booking Number: ${data.bookingNumber}`,
    `Customer: ${data.customerName}`,
    `VIN: ${data.vinNumber}`,
    `Days requested: ${data.requestedDays}`,
    approved ? `Days approved: ${granted}` : 'Outcome: Rejected — standard window stands',
    `Decided by: ${data.decidedByName}`,
    data.remarks ? `Remarks: ${data.remarks}` : '',
    '',
    data.bookingUrl ? `Open booking: ${data.bookingUrl}` : '',
    '',
    'AM Kia',
  ].filter((line) => line !== '').join('\n')

  return { subject: paymentWindowDecisionSubject(data), html, text }
}
