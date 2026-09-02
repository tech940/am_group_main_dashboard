/**
 * Re-submitting a request that an approver SENT BACK — for every brand.
 *
 * ── The bug this exists to fix ────────────────────────────────────────────────────────────────
 * The send-back email carries a signed link back to the submission form, and the form posts to
 * `/api/brands/{brand}/approvals`. KIA has its own static route and handled the token there. Every
 * other brand falls through to the dynamic `[brand]` route — which had NO token branch at all, so
 * the re-submission was treated as a brand-new request.
 *
 * The result, measured on live data before this module existed:
 *
 *   HYUNDAI_0019  Rs1,41,507  Madhur Paints  sent back 31 Aug 07:49 "Attacment missing"
 *   HYUNDAI_0022  Rs1,41,507  Madhur Paints  created  31 Aug 10:35  — the same submitter, again
 *
 * HYUNDAI_0022 went on to the EA. HYUNDAI_0019 is still parked at `SentBack`, invisible in every
 * queue (the screen drops a sent-back row from "pending for me") and un-actionable — while the
 * server's own stage resolver still reports it as sitting at the first approver's desk. Two rows
 * for one payment, one of which nobody can clear and either of which could be approved.
 *
 * No non-KIA request has ever carried a `RESUBMITTED` history entry; all three that do are KIA.
 *
 * This matters most to the Group Service Manager, whose entire remit is Hyundai and Platinum
 * service: every request he sends back for a missing attachment came back to him as a duplicate.
 *
 * ⚠️ The SIGNED TOKEN is the credential, not the row id. These endpoints are deliberately
 * unauthenticated — submitters have no dashboard login — so accepting a bare id would let anyone
 * overwrite any payment request by guessing. The token is the one the send-back email carried.
 */
import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { verifyResubmitToken } from '@/lib/kia/approval-resubmit'

export type ResubmitInput = {
  /** The parsed request body. Read for the token and the resubmitted field values. */
  body: Record<string, unknown>
  /** The brand segment the request arrived on, normalized. Blank means KIA, as everywhere else. */
  routeBrand: string
  /** Already-normalized bills, computed identically by both callers. */
  normalizedBillUrls: string[]
  mirrorBill1: string | null
  mirrorBill2: string | null
  finalGlAccountId: string | null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** Blank brand means KIA against this table — the same convention brandHasHrStage uses. */
const normBrand = (v: unknown) => (str(v) || 'kia').toLowerCase()

/**
 * Handle a re-submission if the body carries a token.
 *
 * Returns `null` when there is no token, meaning "this is an ordinary new submission — carry on".
 * Any other return value is the response to send.
 */
export async function handleApprovalResubmit(input: ResubmitInput): Promise<NextResponse | null> {
  const { body, routeBrand, normalizedBillUrls, mirrorBill1, mirrorBill2, finalGlAccountId } = input

  const resubmitToken = str(body.resubmitToken)
  if (!resubmitToken) return null

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

  /*
   * The token proves WHICH request, so a brand mismatch is not a security hole — but it is always a
   * mistake, and letting it through would move a request between brands' queues on the strength of
   * a URL. The row's own brand stays authoritative either way; this only refuses the confusion.
   */
  if (normBrand(original.brand) !== normBrand(routeBrand)) {
    return NextResponse.json({
      error: 'This re-submit link belongs to a different brand.',
      reason: 'brand_mismatch',
    }, { status: 400 })
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
    user: str(body.name),
    action: 'RESUBMITTED',
    // The send-back reason is cleared from the row below, so preserve it in the audit trail.
    remarks: original.sendBackReason
      ? `Re-submitted (was sent back: ${original.sendBackReason})`
      : 'Re-submitted after send-back',
    timestamp: new Date().toISOString(),
  })

  /*
   * `vehicle_number` is only written when the form actually sent one. The KIA form does not carry
   * this field, so unconditionally setting it would blank the column on every KIA re-submission.
   */
  const vehicleNumber = str(body.vehicleNumber)

  const [updated] = await db
    .update(kiaApprovalRequests)
    .set({
      email: str(body.email),
      name: str(body.name),
      employeeId: str(body.employeeId) || null,
      location: str(body.location) || null,
      dealerCode: str(body.dealerCode) || null,
      dealerName: str(body.dealerName) || null,
      department: str(body.department) || null,
      specifyOtherDepartment: str(body.specifyOtherDepartment) || null,
      approvalType: str(body.approvalType) || null,
      vendorName: str(body.vendorName) || null,
      specifyOtherApprovalType: str(body.specifyOtherApprovalType) || null,
      previousAdvance: str(body.previousAdvance) || null,
      amount: String(body.amount),
      typeOfPayment: str(body.typeOfPayment) || null,
      remarks: str(body.remarks) || null,
      // The re-submit form does not always carry the original attachments back, so a missing
      // URL means "keep what was uploaded before", never "delete it".
      billUrls: normalizedBillUrls.length
        ? normalizedBillUrls
        : (original.billUrls?.length ? original.billUrls : []),
      uploadBillUrl1: mirrorBill1 || original.uploadBillUrl1 || null,
      uploadBillUrl2: mirrorBill2 || original.uploadBillUrl2 || null,
      uploadDocUrl: str(body.uploadDocUrl) || original.uploadDocUrl || null,
      glAccountId: finalGlAccountId,
      gst: str(body.gst) || null,
      ...(vehicleNumber ? { vehicleNumber } : {}),
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
    requestNo: updated.requestNo,
    resubmitted: true,
    message: 'Request re-submitted successfully.',
  })
}
