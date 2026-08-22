import { NextRequest, NextResponse } from 'next/server'
import { findMissingApprovalField } from '@/lib/approvals/required-fields'
import { allocateRequestNumber } from '@/lib/approvals/request-number'
import { db } from '@/lib/db'
import { kiaApprovalRequests, glAccounts } from '@/lib/db/schema'
import { and, asc, eq, or } from 'drizzle-orm'
import { verifyResubmitToken } from '@/lib/kia/approval-resubmit'

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

    // Re-submission of a sent-back request: UPDATE the original row instead of creating a second
    // request the approvers would have to reconcile against the first.
    //
    // ⚠️ The SIGNED TOKEN is the credential, not the row id. This endpoint is unauthenticated
    // (submitters have no login), so accepting a bare `resubmitId` would let anyone overwrite any
    // payment request by guessing ids. The token is the same one the send-back email carried.
    const resubmitToken = typeof body.resubmitToken === 'string' ? body.resubmitToken.trim() : ''
    if (resubmitToken) {
      const verified = verifyResubmitToken(resubmitToken)
      if (!verified.ok) {
        const message = verified.reason === 'expired'
          ? 'This re-submit link has expired. Please ask for the request to be sent back again.'
          : 'This re-submit link is not valid.'
        return NextResponse.json({ error: message, reason: verified.reason }, { status: 400 })
      }

      const [original] = await db
        .select()
        .from(kiaApprovalRequests)
        .where(eq(kiaApprovalRequests.id, verified.requestId))
        .limit(1)

      if (!original) {
        return NextResponse.json({ error: 'The original request could not be found.' }, { status: 404 })
      }
      if (original.emailSendStatus !== 'SentBack') {
        return NextResponse.json({
          error: 'This request is no longer awaiting re-submission. It may have already been re-submitted or actioned.',
          reason: 'not_sent_back',
        }, { status: 409 })
      }

      const historyList = Array.isArray(original.history) ? [...original.history] : []
      historyList.push({
        id: Math.random().toString(36).substring(7),
        role: 'Submitter',
        roleKey: 'submitter',
        user: name.trim(),
        action: 'RESUBMITTED',
        // The send-back reason is cleared from the row below, so preserve it in the audit trail.
        remarks: original.sendBackReason
          ? `Re-submitted (was sent back: ${original.sendBackReason})`
          : 'Re-submitted after send-back',
        timestamp: new Date().toISOString(),
      })

      const [updated] = await db
        .update(kiaApprovalRequests)
        .set({
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
          // The re-submit form does not always carry the original attachments back, so a missing
          // URL means "keep what was uploaded before", never "delete it".
          billUrls: normalizedBillUrls.length
            ? normalizedBillUrls
            : (original.billUrls?.length ? original.billUrls : []),
          uploadBillUrl1: mirrorBill1 || original.uploadBillUrl1 || null,
          uploadBillUrl2: mirrorBill2 || original.uploadBillUrl2 || null,
          uploadDocUrl: uploadDocUrl || original.uploadDocUrl || null,
          glAccountId: finalGlAccountId,
          gst: gst?.trim() || null,
          // Reset the chain to the same state a fresh submission starts in; SEND_BACK already
          // nulled the per-stage approvals, and the who-did-what lives in `history`.
          vpApproval: '',
          hrApproval: '',
          accountApproval: '',
          eaApproval: '',
          managementApproval: '',
          managementRemarks: '',
          sendBackReason: null,
          emailSendStatus: 'Mail Sent',
          history: historyList,
          updatedAt: new Date(),
        })
        // The status guard in the WHERE (not just the read above) makes a double-click or a
        // concurrently used link lose cleanly instead of silently re-running the reset.
        .where(and(
          eq(kiaApprovalRequests.id, verified.requestId),
          eq(kiaApprovalRequests.emailSendStatus, 'SentBack'),
        ))
        .returning()

      if (!updated) {
        return NextResponse.json({
          error: 'This request is no longer awaiting re-submission. It may have already been re-submitted or actioned.',
          reason: 'not_sent_back',
        }, { status: 409 })
      }

      return NextResponse.json({
        success: true,
        id: updated.id,
        resubmitted: true,
        message: 'Request re-submitted successfully.',
      })
    }

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
