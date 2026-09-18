import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { FeedbackSubmitInput } from './schemas'
import { normalizeMobile, tidyText, titleCaseName, walkInBranchLabel } from '../walk-in-leads/constants'

export class FeedbackError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'FeedbackError'
  }
}

const FLOOD_LIMIT = 30

type Row = Record<string, unknown>

function rows<T = Row>(result: unknown): T[] {
  return result as unknown as T[]
}

import { sendManagementFeedbackAlert } from './alert-email'

/**
 * Public submission of showroom customer feedback.
 */
export async function createWalkInFeedback(
  dealerCode: string,
  input: FeedbackSubmitInput,
): Promise<{ id: string }> {
  let customerName = input.customerName ? titleCaseName(input.customerName) : null
  let mobile = input.mobile ? normalizeMobile(input.mobile) : null
  let model = input.model ?? null
  let consultantName = input.consultantName ? titleCaseName(input.consultantName) : null

  // If leadId is attached but details were not filled in, look up the lead
  if (input.walkInLeadId && (!customerName || !mobile || !model || !consultantName)) {
    try {
      const leadRes: any = await db.execute(sql`
        SELECT customer_name, mobile, model, consultant_name
        FROM kia_walk_in_leads
        WHERE id = ${input.walkInLeadId}::uuid
        LIMIT 1
      `)
      const leadRow = Array.isArray(leadRes) ? leadRes[0] : leadRes?.rows?.[0]
      if (leadRow) {
        if (!customerName && leadRow.customer_name) customerName = leadRow.customer_name
        if (!mobile && leadRow.mobile) mobile = leadRow.mobile
        if (!model && leadRow.model) model = leadRow.model
        if (!consultantName && leadRow.consultant_name) consultantName = leadRow.consultant_name
      }
    } catch {
      // Non-fatal lookup fallback
    }
  }

  const experienceTagsJson = input.experienceTags && input.experienceTags.length > 0
    ? JSON.stringify(input.experienceTags)
    : null

  const result = rows<{ inserted: string | null; recent: number }>(await db.execute(sql`
    WITH recent_submissions AS (
      SELECT COUNT(*)::int AS count
      FROM kia_walk_in_feedback
      WHERE dealer_code = ${dealerCode}
        AND created_at > now() - interval '10 minutes'
    ),
    do_insert AS (
      INSERT INTO kia_walk_in_feedback (
        walk_in_lead_id,
        dealer_code,
        customer_name,
        country_code,
        mobile,
        model,
        consultant_name,
        overall_rating,
        staff_courtesy_rating,
        test_drive_rating,
        showroom_ambience_rating,
        experience_tags,
        remarks,
        source
      )
      SELECT
        ${input.walkInLeadId ? input.walkInLeadId : null}::uuid,
        ${dealerCode},
        ${customerName},
        '+91',
        ${mobile},
        ${model},
        ${consultantName},
        ${input.overallRating}::smallint,
        ${input.staffCourtesyRating ? input.staffCourtesyRating : null}::smallint,
        ${input.testDriveRating ? input.testDriveRating : null}::smallint,
        ${input.showroomAmbienceRating ? input.showroomAmbienceRating : null}::smallint,
        ${experienceTagsJson}::jsonb,
        ${input.remarks ? tidyText(input.remarks) : null},
        ${input.source || 'qr_feedback'}
      WHERE (SELECT count FROM recent_submissions) < ${FLOOD_LIMIT}
      RETURNING id::text
    )
    SELECT
      (SELECT id FROM do_insert) AS inserted,
      (SELECT count FROM recent_submissions) AS recent
  `))

  const first = result[0]
  if (!first) throw new FeedbackError('Failed to record your feedback. Please try again.', 500)
  if (first.inserted) {
    // Dispatch management notification email to tech@amgroupind.com & aryan@amgroupind.com
    sendManagementFeedbackAlert(dealerCode, {
      ...input,
      customerName,
      mobile,
      model,
      consultantName,
    }).catch((err) => {
      console.error('[feedback-submission] Error sending management alert:', err)
    })

    return { id: first.inserted }
  }
  if (Number(first.recent ?? 0) >= FLOOD_LIMIT) {
    throw new FeedbackError('Too many submissions right now. Please wait a moment.', 429)
  }

  throw new FeedbackError('Could not save feedback.', 500)
}

import type { FeedbackRow, FeedbackDashboardData } from './types'
export type { FeedbackRow, FeedbackDashboardData }

export async function listWalkInFeedback(params?: {
  dealerCode?: string
  from?: string
  to?: string
  limit?: number
}): Promise<FeedbackDashboardData> {
  const result = rows<{
    id: string
    dealer_code: string
    customer_name: string | null
    mobile: string | null
    model: string | null
    consultant_name: string | null
    overall_rating: number
    staff_courtesy_rating: number | null
    test_drive_rating: number | null
    showroom_ambience_rating: number | null
    experience_tags: string[] | null
    remarks: string | null
    source: string
    created_at: string
  }>(await db.execute(sql`
    SELECT
      id::text,
      dealer_code,
      customer_name,
      mobile,
      model,
      consultant_name,
      overall_rating::int,
      staff_courtesy_rating::int,
      test_drive_rating::int,
      showroom_ambience_rating::int,
      experience_tags,
      remarks,
      source,
      created_at::text
    FROM kia_walk_in_feedback
    WHERE (${params?.dealerCode ?? null}::text IS NULL OR dealer_code = ${params?.dealerCode ?? null})
      AND (${params?.from ?? null}::date IS NULL OR created_at::date >= ${params?.from ?? null}::date)
      AND (${params?.to ?? null}::date IS NULL OR created_at::date <= ${params?.to ?? null}::date)
    ORDER BY created_at DESC
    LIMIT ${params?.limit ?? 100}
  `))

  const feedbackRows: FeedbackRow[] = result.map((r) => ({
    id: r.id,
    dealerCode: r.dealer_code,
    branch: walkInBranchLabel(r.dealer_code),
    customerName: r.customer_name,
    mobile: r.mobile,
    model: r.model,
    consultantName: r.consultant_name,
    overallRating: Number(r.overall_rating) || 5,
    staffCourtesyRating: r.staff_courtesy_rating !== null ? Number(r.staff_courtesy_rating) : null,
    testDriveRating: r.test_drive_rating !== null ? Number(r.test_drive_rating) : null,
    showroomAmbienceRating: r.showroom_ambience_rating !== null ? Number(r.showroom_ambience_rating) : null,
    experienceTags: Array.isArray(r.experience_tags) ? r.experience_tags : [],
    remarks: r.remarks,
    source: r.source,
    createdAt: r.created_at,
  }))

  const total = feedbackRows.length
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sumRating = 0
  let sumCourtesy = 0
  let countCourtesy = 0
  let sumTestDrive = 0
  let countTestDrive = 0
  let sumAmbience = 0
  let countAmbience = 0
  let positiveCount = 0

  for (const row of feedbackRows) {
    const rate = Math.max(1, Math.min(5, Math.round(row.overallRating))) as 1 | 2 | 3 | 4 | 5
    ratingCounts[rate] = (ratingCounts[rate] || 0) + 1
    sumRating += rate
    if (rate >= 4) positiveCount++

    if (row.staffCourtesyRating) {
      sumCourtesy += row.staffCourtesyRating
      countCourtesy++
    }
    if (row.testDriveRating) {
      sumTestDrive += row.testDriveRating
      countTestDrive++
    }
    if (row.showroomAmbienceRating) {
      sumAmbience += row.showroomAmbienceRating
      countAmbience++
    }
  }

  const avgRating = total > 0 ? Number((sumRating / total).toFixed(1)) : 5.0
  const avgCourtesy = countCourtesy > 0 ? Number((sumCourtesy / countCourtesy).toFixed(1)) : 5.0
  const avgTestDrive = countTestDrive > 0 ? Number((sumTestDrive / countTestDrive).toFixed(1)) : 5.0
  const avgAmbience = countAmbience > 0 ? Number((sumAmbience / countAmbience).toFixed(1)) : 5.0
  const positivePct = total > 0 ? Math.round((positiveCount / total) * 100) : 100

  return {
    rows: feedbackRows,
    total,
    summary: {
      total,
      avgRating,
      ratingCounts,
      avgCourtesy,
      avgTestDrive,
      avgAmbience,
      positivePct,
    },
  }
}
