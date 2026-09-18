import { detailTable, emailLayout, escapeHtml, primaryButton } from './layout'

export type ManagementFeedbackAlertOptions = {
  customerName: string
  mobile?: string | null
  branchName: string
  model?: string | null
  consultantName?: string | null
  overallRating: number
  staffCourtesyRating?: number | null
  testDriveRating?: number | null
  showroomAmbienceRating?: number | null
  experienceTags?: string[] | null
  remarks?: string | null
  submittedAt: string
  dashboardUrl: string
}

function stars(rating: number): string {
  const full = '★'.repeat(Math.max(1, Math.min(5, Math.round(rating))))
  const empty = '☆'.repeat(Math.max(0, 5 - Math.round(rating)))
  return `${full}${empty}`
}

function ratingLabel(rating: number): string {
  if (rating >= 5) return '⭐⭐⭐⭐⭐ (5/5) — Excellent'
  if (rating === 4) return '⭐⭐⭐⭐☆ (4/5) — Good'
  if (rating === 3) return '⭐⭐⭐☆☆ (3/5) — Average'
  if (rating === 2) return '⭐⭐☆☆☆ (2/5) — Poor / Unsatisfactory'
  return '⭐☆☆☆☆ (1/5) — Critical'
}

export function managementFeedbackAlertTemplate(options: ManagementFeedbackAlertOptions): {
  subject: string
  html: string
  text: string
} {
  const isHighRating = options.overallRating >= 4
  const isCritical = options.overallRating <= 2
  const indicator = isHighRating ? '🟢' : isCritical ? '🔴' : '🟡'
  const prefix = isCritical ? '[CRITICAL ALERT]' : '[CUSTOMER FEEDBACK]'

  const subject = `${indicator} ${prefix} ${options.overallRating}★ Rating: ${options.customerName || 'Customer'} — ${options.branchName}`

  const tagsHtml = options.experienceTags && options.experienceTags.length > 0
    ? `
      <div style="margin:16px 0;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;">Experience Highlights</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${options.experienceTags.map(tag => `<span style="display:inline-block;padding:4px 10px;margin:2px 4px 2px 0;background:#f3f4f6;border-radius:12px;font-size:12px;font-weight:600;color:#374151;">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
    `
    : ''

  const remarksHtml = options.remarks
    ? `
      <div style="margin:18px 0;padding:14px 18px;background:${isCritical ? '#fef2f2' : '#f8fafc'};border-left:4px solid ${isCritical ? '#ef4444' : '#055B65'};border-radius:8px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${isCritical ? '#991b1b' : '#055B65'};">Customer Comments</p>
        <p style="margin:0;font-size:14px;color:#1f2937;font-style:italic;line-height:1.5;">"${escapeHtml(options.remarks)}"</p>
      </div>
    `
    : ''

  const bodyHtml = `
    <div style="padding:14px 18px;border-radius:12px;margin-bottom:20px;background:${isHighRating ? '#ecfdf5' : isCritical ? '#fff1f2' : '#fffbeb'};border:1px solid ${isHighRating ? '#a7f3d0' : isCritical ? '#fecdd3' : '#fde68a'};">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:18px;font-weight:800;color:${isHighRating ? '#065f46' : isCritical ? '#9f1239' : '#92400e'};">
          ${stars(options.overallRating)} &nbsp; ${options.overallRating}.0 / 5.0 Rating
        </span>
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${isHighRating ? '#047857' : isCritical ? '#be123c' : '#b45309'};">
          ${isHighRating ? 'Positive Experience' : isCritical ? 'Requires Attention' : 'Moderate'}
        </span>
      </div>
    </div>

    <div style="margin:16px 0;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#055B65;">Customer & Visit Details</p>
      ${detailTable([
        ['Customer Name', options.customerName || 'N/A'],
        ['Contact Mobile', options.mobile || 'N/A'],
        ['Showroom Branch', options.branchName],
        ['Model Explored', options.model ? `Kia ${options.model}` : 'N/A'],
        ['Sales Consultant', options.consultantName || 'N/A'],
        ['Submitted At', options.submittedAt],
      ])}
    </div>

    <div style="margin:20px 0;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#055B65;">Ratings Breakdown</p>
      ${detailTable([
        ['Overall Rating', ratingLabel(options.overallRating)],
        ['Staff Courtesy', options.staffCourtesyRating ? `${stars(options.staffCourtesyRating)} (${options.staffCourtesyRating}/5)` : 'Not rated'],
        ['Test Drive Experience', options.testDriveRating ? `${stars(options.testDriveRating)} (${options.testDriveRating}/5)` : 'Not rated'],
        ['Showroom Ambience', options.showroomAmbienceRating ? `${stars(options.showroomAmbienceRating)} (${options.showroomAmbienceRating}/5)` : 'Not rated'],
      ])}
    </div>

    ${tagsHtml}
    ${remarksHtml}

    <div style="text-align:center;margin:28px 0 10px;">
      ${primaryButton(options.dashboardUrl, '📊 Open Feedback Register in Dashboard')}
    </div>
  `

  const text = `CUSTOMER FEEDBACK ALERT
Rating: ${options.overallRating}/5 stars
Customer: ${options.customerName} (${options.mobile || 'N/A'})
Showroom: ${options.branchName}
Model: ${options.model || 'N/A'}
Sales Consultant: ${options.consultantName || 'N/A'}
Submitted At: ${options.submittedAt}

RATINGS:
• Overall: ${options.overallRating}/5
• Staff Courtesy: ${options.staffCourtesyRating ? `${options.staffCourtesyRating}/5` : 'N/A'}
• Test Drive: ${options.testDriveRating ? `${options.testDriveRating}/5` : 'N/A'}
• Showroom Ambience: ${options.showroomAmbienceRating ? `${options.showroomAmbienceRating}/5` : 'N/A'}

${options.experienceTags && options.experienceTags.length > 0 ? `Tags: ${options.experienceTags.join(', ')}\n` : ''}${options.remarks ? `Customer Comments: "${options.remarks}"\n` : ''}
View in Dashboard:
${options.dashboardUrl}`

  const html = emailLayout({
    eyebrow: 'Customer Feedback Alert',
    heading: `${options.overallRating}★ Showroom Rating Received`,
    preheader: `New ${options.overallRating}★ rating submitted by ${options.customerName || 'customer'} at ${options.branchName}.`,
    bodyHtml,
  })

  return { subject, html, text }
}
