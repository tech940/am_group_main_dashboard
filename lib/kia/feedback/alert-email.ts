import 'server-only'

import { sendEmail } from '@/lib/email/email-service'
import { managementFeedbackAlertTemplate } from '@/lib/email/templates/management-feedback-alert'
import { feedbackBranchLabel } from './constants'
import type { FeedbackSubmitInput } from './schemas'

const MANAGEMENT_ALERT_RECIPIENTS = ['tech@amgroupind.com', 'aryan@amgroupind.com']

function getDashboardUrl(): string {
  const customPublicUrl = process.env.CUSTOMER_PORTAL_URL || process.env.PUBLIC_APP_URL
  if (customPublicUrl) return `${customPublicUrl.replace(/\/$/, '')}/brands/kia/walk-in-leads?tab=feedback`

  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return `${envUrl.replace(/\/$/, '')}/brands/kia/walk-in-leads?tab=feedback`
  }

  return 'https://app.amautomotivegroup.com/brands/kia/walk-in-leads?tab=feedback'
}

export async function sendManagementFeedbackAlert(
  dealerCode: string,
  input: FeedbackSubmitInput,
): Promise<void> {
  const branchName = feedbackBranchLabel(dealerCode) || 'AM Kia Showroom'
  const submittedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())

  const { subject, html, text } = managementFeedbackAlertTemplate({
    customerName: input.customerName || 'Customer',
    mobile: input.mobile || null,
    branchName,
    model: input.model || null,
    consultantName: input.consultantName || null,
    overallRating: input.overallRating,
    staffCourtesyRating: input.staffCourtesyRating || null,
    testDriveRating: input.testDriveRating || null,
    showroomAmbienceRating: input.showroomAmbienceRating || null,
    experienceTags: input.experienceTags || null,
    remarks: input.remarks || null,
    submittedAt,
    dashboardUrl: getDashboardUrl(),
  })

  try {
    await sendEmail({
      to: MANAGEMENT_ALERT_RECIPIENTS,
      subject,
      html,
      text,
    })
    console.log(`[feedback-alert] Successfully sent rating alert (${input.overallRating} stars) to ${MANAGEMENT_ALERT_RECIPIENTS.join(', ')}`)
  } catch (err) {
    console.error('[feedback-alert] Failed to send management feedback alert email:', err)
  }
}
