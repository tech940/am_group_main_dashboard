import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas, kiaBookings, kiaBookingActivity } from '@/lib/db/schema'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import {
  kiaApprovalStage,
  kiaStageActorLabel,
  nextApprovalStatusAfterApprove,
  pendingStageOf,
  roleActsOnKiaStage,
} from '@/lib/kia-proforma/approval'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { serializeUtcTimestampFields } from '@/lib/date-time'
import { saveKiaProformaPdf, buildKiaProformaPdf } from '@/lib/kia-proforma/invoice'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { buildTrackingUrl } from '@/lib/kia/tracking'
import { buildApprovedProformaEmail } from '@/lib/email/templates'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

const VERIFY_FIELDS = [
  ['cashDiscount', 'CASH DISCOUNT'],
  ['exchangeValue', 'EXCHANGE VALUE'],
  ['bookingAmount', 'BOOKING AMOUNT'],
  ['govtEmployeeDiscount', 'GOVT EMPLOYEE DISCOUNT'],
  ['additionalDiscount', 'ADDITIONAL DISCOUNT'],
  ['insuranceValue', 'INSURANCE VALUE'],
  ['extWarranty', 'EXT WARRANTY'],
] as const

function serialize(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, ['entryTime', 'proformaDate', 'financeUpdatedTime', 'createdAt', 'updatedAt', 'deletedAt'])
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

async function getRow(id: string) {
  const [row] = await db
    .select()
    .from(kiaProformas)
    .where(and(eq(kiaProformas.id, id), isNull(kiaProformas.deletedAt)))
    .limit(1)
  return row
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const profile = await ensureKiaUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isApprover = await canApproveKiaProformaForUser(appUser, profile.approver)
    const { id } = await context.params
    const row = await getRow(id)
    if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })

    const ownsRow = row.loginEmail === appUser.email
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = text(body.action)
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    let isApproved = false
    let approvalStageActed: string | null = null
    let approvalDeclined = false

    if (action === 'finance') {
      const permission = await requirePermission(appUser, 'kia.proforma.edit')
      if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
      if (!isApprover && !ownsRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const remarks = text(body.financeRemarks)
      updates.financeStatus = text(body.financeStatus) || 'Pending'
      updates.financeRemarks = remarks || null
      updates.financeUpdatedTime = remarks || updates.financeStatus !== row.financeStatus ? new Date() : null
    } else if (action === 'approval') {
      const permission = await requirePermission(appUser, 'kia.proforma.approve')
      if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
      if (!isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      // Sequential chain: Finance Head -> Sales Manager -> General Manager.
      if (kiaApprovalStage(row.approvalStatus) === 'approved') {
        return NextResponse.json({ error: 'This proforma is already fully approved.' }, { status: 400 })
      }
      const stage = pendingStageOf(row.approvalStatus)
      if (!roleActsOnKiaStage(appUser.role, stage)) {
        return NextResponse.json({ error: `This proforma is awaiting ${kiaStageActorLabel(stage)} approval.` }, { status: 403 })
      }

      let declined = false
      let declineDetail = ''
      if (body.checks) {
        // Checklist path (Sales Manager / MD / admin): verify the discount fields.
        const checks = (body.checks || {}) as Record<string, { status?: string; reason?: string }>
        const failures = VERIFY_FIELDS
          .map(([key, label]) => ({ label, status: text(checks[key]?.status), reason: text(checks[key]?.reason) }))
          .filter((item) => item.status === 'NOT APPROVED')
        if (failures.length > 0) {
          declined = true
          declineDetail = failures.map((item) => `${item.label} - ${item.reason || 'No reason specified'}`).join(' | ')
        }
        updates.addDiscApproval = checks
      } else {
        // Sales Manager / General Manager: simple approve or decline.
        const decision = text(body.decision).toLowerCase()
        if (decision === 'decline') {
          declined = true
          declineDetail = text(body.declineReason) || 'Declined at ' + kiaStageActorLabel(stage)
        } else if (decision !== 'approve') {
          return NextResponse.json({ error: 'Provide a decision (approve or decline).' }, { status: 400 })
        }
      }

      if (declined) {
        updates.approvalStatus = `NOT APPROVED | ${declineDetail || 'No reason specified'}`
      } else {
        const next = nextApprovalStatusAfterApprove(stage)
        updates.approvalStatus = next.status
        if (next.finalized) {
          isApproved = true
          const pdfUrl = await saveKiaProformaPdf(row)
          updates.linkPreview = pdfUrl || row.linkPreview || `/api/brands/kia/proforma/${id}/preview`
        }
      }
      updates.approvedBy = profile.consultantName || appUser.fullName || appUser.email
      approvalStageActed = stage
      approvalDeclined = declined
    } else if (action === 'settings') {
      if (!ownsRow && !isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.json({ error: 'Use profile settings endpoint' }, { status: 400 })
    } else {
      if (!ownsRow && !isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    const [updated] = await db
      .update(kiaProformas)
      .set(updates)
      .where(eq(kiaProformas.id, id))
      .returning()

    // Reflect approval-chain progress on the linked booking timeline.
    let linkedBookingRow: typeof kiaBookings.$inferSelect | null = null
    if (approvalStageActed) {
      const [linkedBooking] = await db
        .select()
        .from(kiaBookings)
        .where(and(eq(kiaBookings.proformaId, id), isNull(kiaBookings.deletedAt)))
        .limit(1)
      linkedBookingRow = linkedBooking ?? null

      if (linkedBooking) {
        // Only the final GM approval advances the booking into the allotment queue.
        if (isApproved) {
          await db
            .update(kiaBookings)
            .set({
              status: 'proforma_generated',
              updatedAt: new Date(),
              updatedBy: appUser.id,
            })
            .where(eq(kiaBookings.id, linkedBooking.id))
        }

        const actor = profile.consultantName || appUser.fullName || appUser.email
        const actedBy = kiaStageActorLabel(approvalStageActed as ReturnType<typeof pendingStageOf>) || appUser.role
        const title = approvalDeclined
          ? 'Proforma Declined'
          : isApproved
            ? 'Proforma Approved'
            : `Proforma ${actedBy} Approved`
        const description = approvalDeclined
          ? `Declined by ${actor} (${actedBy})`
          : isApproved
            ? `Final approval by ${actor} (General Manager)`
            : `Approved by ${actor} (${actedBy}) — sent to next approver`
        await db.insert(kiaBookingActivity).values({
          bookingId: linkedBooking.id,
          activityType: 'proforma',
          title,
          description,
          actorUserId: appUser.id,
          actorName: appUser.fullName,
          actorRole: appUser.role,
        })
      }
    }

    // Trigger 1: on FINAL approval (Pending → Approved), email the customer.
    // Fire-and-forget — sendTrackedEmail logs the outcome and never throws, so a
    // mail failure can never break the approval workflow.
    if (isApproved) {
      const customerEmail = text(updated.customerEmail)
      if (customerEmail) {
        const bookingDate = linkedBookingRow?.createdAt || updated.proformaDate
        const email = buildApprovedProformaEmail({
          customerName: text(updated.customerName) || 'Customer',
          proformaNumber: String(updated.id).slice(0, 8).toUpperCase(),
          model: text(updated.modelName),
          variant: text(updated.trimDescription),
          color: text(updated.vehicleColor),
          bookingDate: bookingDate ? new Date(bookingDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null,
          consultantName: text(updated.consultant),
          dealerName: text(updated.location) || 'AM Kia',
          trackingUrl: linkedBookingRow?.id ? buildTrackingUrl(linkedBookingRow.id) : null,
        })
        // Attach the approved proforma PDF so the customer receives it directly.
        let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined
        try {
          const pdfBuffer = buildKiaProformaPdf(updated)
          attachments = [{
            filename: `Kia-Proforma-${String(updated.id).slice(0, 8).toUpperCase()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }]
        } catch (pdfError) {
          // Never let a PDF failure block the notification — send without it.
          console.error('Failed to build proforma PDF for approval email:', pdfError)
        }
        await sendTrackedEmail({
          to: customerEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
          emailType: 'approved_proforma',
          bookingId: linkedBookingRow?.id || null,
          attachments,
        })
      }
    }

    return NextResponse.json({ row: serialize(updated as Record<string, unknown>) })
  } catch (error) {
    console.error('Error in PATCH /api/brands/kia/proforma/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
