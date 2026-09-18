import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email/email-service'
import { walkInFeedbackEmailTemplate } from '@/lib/email/templates/walk-in-feedback'
import { customerFeedbackFormPath } from '@/lib/kia/feedback/link'
import { walkInBranchLabel } from './constants'

export type WalkInFeedbackSendResult = {
  leadId: string
  customerName: string
  email: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
}

let columnsEnsured = false

export async function ensureWalkInFeedbackEmailColumns() {
  if (columnsEnsured) return
  try {
    await db.execute(sql`
      ALTER TABLE kia_walk_in_leads ADD COLUMN IF NOT EXISTS feedback_email_sent_at TIMESTAMPTZ;
      ALTER TABLE kia_walk_in_leads ADD COLUMN IF NOT EXISTS feedback_email_status TEXT;
      ALTER TABLE kia_walk_in_leads ADD COLUMN IF NOT EXISTS feedback_email_error TEXT;
    `)
    columnsEnsured = true
  } catch (err) {
    console.error('Failed to ensure feedback email columns on kia_walk_in_leads:', err)
  }
}

function getBaseUrl(): string {
  const customPublicUrl = process.env.CUSTOMER_PORTAL_URL || process.env.PUBLIC_APP_URL
  if (customPublicUrl) return customPublicUrl.replace(/\/$/, '')

  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl.replace(/\/$/, '')
  }

  // Live production base URL
  return 'https://app.amautomotivegroup.com'
}

type EligibleLeadRow = {
  id: string
  dealerCode: string
  customerName: string
  email: string
  mobile: string
  model: string
  consultantName: string
  enquiryDate: string
  createdAt: string
}

/**
 * Finds all walk-in leads who enquired >= 1 hour ago and haven't received a feedback email yet.
 */
export async function getEligibleWalkInFeedbackLeads(): Promise<EligibleLeadRow[]> {
  await ensureWalkInFeedbackEmailColumns()

  const result: any = await db.execute(sql`
    SELECT
      id::text,
      dealer_code AS "dealerCode",
      customer_name AS "customerName",
      email,
      mobile,
      model,
      consultant_name AS "consultantName",
      to_char(enquiry_date, 'YYYY-MM-DD') AS "enquiryDate",
      to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
    FROM kia_walk_in_leads
    WHERE deleted_at IS NULL
      AND email IS NOT NULL
      AND btrim(email) != ''
      AND email LIKE '%@%.%'
      AND feedback_email_sent_at IS NULL
      AND created_at <= now() - interval '1 hour'
      AND enquiry_date >= current_date - interval '3 days'
    ORDER BY created_at ASC
  `)

  const rows = Array.isArray(result) ? result : result.rows || []
  return rows as EligibleLeadRow[]
}

/**
 * Sends the 1-hour post-visit feedback email to a single walk-in lead.
 */
export async function sendFeedbackEmailForLead(lead: EligibleLeadRow): Promise<WalkInFeedbackSendResult> {
  await ensureWalkInFeedbackEmailColumns()

  if (!lead.email || !lead.email.includes('@')) {
    return {
      leadId: lead.id,
      customerName: lead.customerName,
      email: lead.email || 'N/A',
      status: 'skipped',
      error: 'Invalid or missing email address',
    }
  }

  const baseUrl = getBaseUrl()
  const formPath = customerFeedbackFormPath(lead.dealerCode)
  const queryParams = new URLSearchParams({
    leadId: lead.id,
    name: lead.customerName,
    mobile: lead.mobile,
    model: lead.model,
    consultant: lead.consultantName,
  })
  const feedbackUrl = `${baseUrl}${formPath}?${queryParams.toString()}`

  const branchName = walkInBranchLabel(lead.dealerCode) || 'AM Kia Jammu'
  const visitDateFormatted = new Date(`${lead.enquiryDate}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  const { subject, html, text } = walkInFeedbackEmailTemplate({
    customerName: lead.customerName,
    branchName,
    model: lead.model,
    consultantName: lead.consultantName,
    visitDate: visitDateFormatted,
    feedbackUrl,
  })

  try {
    await sendEmail({
      to: lead.email.trim(),
      subject,
      html,
      text,
    })

    await db.execute(sql`
      UPDATE kia_walk_in_leads
      SET
        feedback_email_sent_at = CURRENT_TIMESTAMP,
        feedback_email_status = 'sent',
        feedback_email_error = NULL
      WHERE id = ${lead.id}::uuid
    `)

    return {
      leadId: lead.id,
      customerName: lead.customerName,
      email: lead.email,
      status: 'sent',
    }
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[walk-in-feedback-email] Failed to send feedback email to ${lead.email}:`, err)

    await db.execute(sql`
      UPDATE kia_walk_in_leads
      SET
        feedback_email_status = 'failed',
        feedback_email_error = ${errorMsg.slice(0, 500)}
      WHERE id = ${lead.id}::uuid
    `).catch(() => {})

    return {
      leadId: lead.id,
      customerName: lead.customerName,
      email: lead.email,
      status: 'failed',
      error: errorMsg,
    }
  }
}

/**
 * Dispatches feedback emails to all eligible customers who visited >= 1 hour ago.
 */
export async function dispatchDueWalkInFeedbackEmails(): Promise<{
  eligibleCount: number
  sentCount: number
  failedCount: number
  results: WalkInFeedbackSendResult[]
}> {
  const eligible = await getEligibleWalkInFeedbackLeads()
  const results: WalkInFeedbackSendResult[] = []

  let sentCount = 0
  let failedCount = 0

  for (const lead of eligible) {
    const res = await sendFeedbackEmailForLead(lead)
    results.push(res)
    if (res.status === 'sent') sentCount++
    if (res.status === 'failed') failedCount++
  }

  return {
    eligibleCount: eligible.length,
    sentCount,
    failedCount,
    results,
  }
}
