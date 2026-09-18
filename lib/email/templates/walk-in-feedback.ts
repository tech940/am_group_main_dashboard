import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

export type WalkInFeedbackEmailOptions = {
  customerName: string
  branchName: string
  model: string
  consultantName: string
  visitDate: string
  feedbackUrl: string
}

export function walkInFeedbackEmailTemplate({
  customerName,
  branchName,
  model,
  consultantName,
  visitDate,
  feedbackUrl,
}: WalkInFeedbackEmailOptions): { subject: string; html: string; text: string } {
  const subject = `Thank you for visiting AM Kia — How was your showroom experience?`

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;">
      Dear ${escapeHtml(customerName)},
    </p>
    <p style="margin:0 0 16px;line-height:1.65;color:#4b5563;">
      Thank you for visiting our <strong>${escapeHtml(branchName)}</strong> showroom today! It was our absolute pleasure hosting you while exploring the <strong>Kia ${escapeHtml(model)}</strong> with our Sales Consultant, <strong>${escapeHtml(consultantName)}</strong>.
    </p>

    <div style="margin:20px 0;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#055B65;">
        Visit Summary
      </p>
      ${detailTable([
        ['Showroom', branchName],
        ['Vehicle Explored', `Kia ${model}`],
        ['Sales Consultant', consultantName],
        ['Date of Visit', visitDate],
      ])}
    </div>

    <p style="margin:20px 0 12px;line-height:1.65;color:#4b5563;">
      Your feedback is invaluable in helping us continually elevate our service and ensure that every guest receives a premier dealership experience. Could you spare 60 seconds to let us know how your visit went?
    </p>

    <div style="text-align:center;margin:28px 0;">
      ${primaryButton(feedbackUrl, '⭐ Rate Your Showroom Experience')}
    </div>

    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6b7280;text-align:center;">
      If the button above does not work, copy and paste this link into your browser:<br />
      <a href="${escapeHtml(feedbackUrl)}" style="color:#055B65;word-break:break-all;text-decoration:underline;">${escapeHtml(feedbackUrl)}</a>
    </p>
  `

  const text = `Dear ${customerName},

Thank you for visiting our ${branchName} showroom today! It was our pleasure hosting you while exploring the Kia ${model} with our Sales Consultant, ${consultantName}.

VISIT SUMMARY
• Showroom: ${branchName}
• Vehicle Explored: Kia ${model}
• Sales Consultant: ${consultantName}
• Date of Visit: ${visitDate}

Your feedback is invaluable in helping us continually elevate our service. Could you spare 60 seconds to share your showroom experience?

Please share your feedback here:
${feedbackUrl}

Warm regards,
The AM Kia Team`

  const html = emailLayout({
    eyebrow: 'Showroom Experience',
    heading: 'How was your visit to AM Kia?',
    preheader: `Thank you for visiting AM Kia ${branchName} today. Please take a moment to share your showroom experience.`,
    bodyHtml,
  })

  return { subject, html, text }
}
