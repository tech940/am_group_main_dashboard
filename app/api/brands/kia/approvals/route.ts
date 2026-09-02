import { NextRequest, NextResponse } from 'next/server'
import { findMissingApprovalField } from '@/lib/approvals/required-fields'
import { allocateRequestNumber } from '@/lib/approvals/request-number'
import { db } from '@/lib/db'
import { kiaApprovalRequests, glAccounts } from '@/lib/db/schema'
import { and, asc, eq, or } from 'drizzle-orm'
import { handleApprovalResubmit } from '@/lib/approvals/resubmit'

export async function POST(request: NextRequest) {
  try {
    // ⚠️ DELIBERATELY UNAUTHENTICATED. The people who raise vendor payment requests do NOT have
    // dashboard logins — they reach this from a public form. An auth guard here locks out the
    // entire intake path, so protection has to come from validation and rate limiting, not a
    // session check. See the security note in the section README / owner discussion.
    const body = await request.json()
    const {
      email,
      name,
      employeeId,
      location,
      dealerCode,
      dealerName,
      department,
      specifyOtherDepartment,
      approvalType,
      vendorName,
      specifyOtherApprovalType,
      previousAdvance,
      amount,
      typeOfPayment,
      remarks,
      uploadBillUrl1,
      uploadBillUrl2,
      uploadDocUrl,
      billUrls,
      glAccountId,
      gst,
    } = body

    /*
     * Every field except bills/documents is mandatory, for all brands. Enforced HERE because this
     * endpoint is deliberately unauthenticated — the form's own checks are a courtesy, not a
     * control. See lib/approvals/required-fields.ts.
     */
    const missingField = findMissingApprovalField(body)
    if (missingField) {
      return NextResponse.json({ error: missingField }, { status: 400 })
    }

    /**
     * Bills arrive as an ordered array from the single multi-file upload. Older clients (and the
     * re-submit flow) may still send only the two flat fields, so accept either shape.
     *
     * The first two entries are mirrored back into upload_bill_url_1/2 because the approver UI,
     * the notification emails and the printed voucher read those columns — writing only the array
     * would hide bills from the people approving the payment.
     */
    const normalizedBillUrls: string[] = (
      Array.isArray(billUrls) && billUrls.length
        ? billUrls
        : [uploadBillUrl1, uploadBillUrl2]
    )
      .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u: string) => u.trim())

    const [mirrorBill1 = null, mirrorBill2 = null] = normalizedBillUrls

    // Resolve GL Account: if missing, unmapped, or invalid UUID, fallback gracefully
    let finalGlAccountId: string | null = null
    if (glAccountId && typeof glAccountId === 'string' && glAccountId.trim()) {
      const trimmed = glAccountId.trim()
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
      if (isUuid) {
        finalGlAccountId = trimmed
      }
    }

    if (!finalGlAccountId) {
      try {
        const fallbackGl = await db
          .select({ id: glAccounts.id })
          .from(glAccounts)
          .where(or(eq(glAccounts.appliesTo, 'both'), eq(glAccounts.appliesTo, 'kia')))
          .orderBy(asc(glAccounts.glCode))
          .limit(1)

        if (fallbackGl.length > 0) {
          finalGlAccountId = fallbackGl[0].id
        }
      } catch (e) {
        console.warn('Fallback GL Account query error:', e)
      }
    }

    /*
     * Re-submission of a sent-back request: UPDATE the original row instead of creating a second
     * request the approvers would have to reconcile against the first.
     *
     * ⚠️ Shared with the other brands' route. This logic lived only here, so a Hyundai or Platinum
     * re-submission — which posts to `/api/brands/[brand]/approvals` — created a DUPLICATE and left
     * the original stranded at `SentBack`. See lib/approvals/resubmit.ts for the measured damage.
     */
    const resubmitted = await handleApprovalResubmit({
      body, routeBrand: 'kia', normalizedBillUrls, mirrorBill1, mirrorBill2, finalGlAccountId,
    })
    if (resubmitted) return resubmitted

    // Per-brand request number (KIA_0001). Allocated atomically — see the module for why a
    // single ON CONFLICT statement rather than MAX+1, given this endpoint is public intake.
    const requestNo = await allocateRequestNumber('kia')

    const [inserted] = await db
      .insert(kiaApprovalRequests)
      .values({
        // Omitted entirely before migration 0039 — naming an absent column fails the insert.
        ...(requestNo ? { requestNo } : {}),
        email: email.trim(),
        name: name.trim(),
        employeeId: employeeId?.trim() || null,
        location: location || null,
        dealerCode: dealerCode || null,
        dealerName: dealerName || null,
        department: department || null,
        specifyOtherDepartment: specifyOtherDepartment?.trim() || null,
        approvalType: approvalType || null,
        vendorName: vendorName?.trim() || null,
        specifyOtherApprovalType: specifyOtherApprovalType?.trim() || null,
        previousAdvance: previousAdvance?.trim() || null,
        amount: String(amount),
        typeOfPayment: typeOfPayment || null,
        remarks: remarks?.trim() || null,
        billUrls: normalizedBillUrls,
        uploadBillUrl1: mirrorBill1,
        uploadBillUrl2: mirrorBill2,
        uploadDocUrl: uploadDocUrl || null,
        vpApproval: '',
        accountApproval: '',
        hrApproval: '',
        eaApproval: '',
        managementApproval: '',
        managementRemarks: '',
        emailSendStatus: 'Mail Sent',
        glAccountId: finalGlAccountId,
        gst: gst?.trim() || null,
      })
      .returning()

    return NextResponse.json({
      success: true,
      id: inserted.id,
      message: 'Approval request submitted successfully.',
    })
  } catch (error) {
    console.error('Error submitting approval request:', error)
    return NextResponse.json(
      {
        error: 'Failed to submit approval request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
