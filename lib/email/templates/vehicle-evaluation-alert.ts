/**
 * The internal alert for a /sell-used-car lead.
 *
 * ⚠️ Every customer-typed value is escaped: the form is public, so a "name" can be HTML — unescaped it would
 * put an attacker's links and markup inside a mail our own staff trust.
 */

export interface VehicleEvaluationAlertParams {
  customerName: string
  mobile: string
  brand: string
  model: string
  manufacturingYear: number
  kilometres: string
  evaluationDate: string
  interestedInNewCar: boolean
  submittedAt: string
  reference: string
  correctsReference?: string | null
  campaign?: string | null
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function vehicleEvaluationAlertTemplate(params: VehicleEvaluationAlertParams): {
  subject: string
  html: string
  text: string
} {
  const phone = params.mobile.replace(/\D/g, '').slice(-10)
  const car = `${params.manufacturingYear} ${params.brand} ${params.model}`
  const newCar = params.interestedInNewCar ? 'Yes — also looking at a new car' : 'No'
  const whatsappUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(
    `Hello ${params.customerName}, this is AM Group, Jammu, about the evaluation of your ${car}.`,
  )}`

  // Subject lines are headers, not HTML — but strip anything that could fold the header.
  const subject = `Car evaluation lead ${params.reference}: ${params.customerName} — ${car}`.replace(/[\r\n]+/g, ' ').slice(0, 180)

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#56687a;width:42%;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:#13202c;font-weight:600;">${value}</td>
    </tr>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#edf1f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#edf1f4;padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #d5dde3;border-radius:10px;">
        <tr><td style="padding:22px 24px 6px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#56687a;">Sell-your-car page · new lead</div>
          <div style="font-size:20px;font-weight:800;color:#13202c;margin-top:6px;">${escapeHtml(params.customerName)}</div>
          <div style="font-size:15px;color:#13202c;margin-top:2px;">+91 ${escapeHtml(phone)}</div>
        </td></tr>
        <tr><td style="padding:10px 24px 4px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${row('Reference', escapeHtml(params.reference))}
            ${params.correctsReference ? row('Corrects', `${escapeHtml(params.correctsReference)} (the number on that request was wrong)`) : ''}
            ${row('Car', escapeHtml(car))}
            ${row('Kilometres', `${escapeHtml(params.kilometres)} km`)}
            ${row('Evaluation wanted on', escapeHtml(params.evaluationDate))}
            ${row('New car', escapeHtml(newCar))}
            ${params.campaign ? row('Campaign', escapeHtml(params.campaign)) : ''}
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px 22px;">
          <a href="tel:+91${escapeHtml(phone)}" style="display:inline-block;background:#c8470e;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-size:14px;font-weight:700;">Call +91 ${escapeHtml(phone)}</a>
          <a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;margin-left:8px;color:#13202c;text-decoration:underline;padding:11px 4px;font-size:14px;font-weight:600;">Message on WhatsApp</a>
        </td></tr>
        <tr><td style="padding:12px 24px;border-top:1px solid #edf1f4;font-size:12px;color:#56687a;">Submitted ${escapeHtml(params.submittedAt)} IST. Call to confirm the time and place.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    'New car evaluation lead (sell-your-car page)',
    '',
    `Name: ${params.customerName}`,
    `Mobile: +91 ${phone}`,
    `Reference: ${params.reference}`,
    ...(params.correctsReference ? [`Corrects: ${params.correctsReference} (the number on that request was wrong)`] : []),
    `Car: ${car}`,
    `Kilometres: ${params.kilometres} km`,
    `Evaluation wanted on: ${params.evaluationDate}`,
    `New car: ${newCar}`,
    ...(params.campaign ? [`Campaign: ${params.campaign}`] : []),
    '',
    `Submitted ${params.submittedAt} IST. Call to confirm the time and place.`,
  ].join('\n')

  return { subject, html, text }
}
