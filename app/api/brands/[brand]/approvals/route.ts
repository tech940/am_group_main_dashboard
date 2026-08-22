import { NextRequest, NextResponse } from 'next/server'
import { findMissingApprovalField } from '@/lib/approvals/required-fields'
import { allocateRequestNumber } from '@/lib/approvals/request-number'
import { db } from '@/lib/db'
import { kiaApprovalRequests, approvalsCommonData, glAccounts } from '@/lib/db/schema'
import { and, asc, eq, or } from 'drizzle-orm'
import { validateEmailDomain } from '@/lib/email-validator'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

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
      vehicleNumber,
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

    /*
     * ⚠️ `billUrls` is the field the form actually sends.
     *
     * features/approvals/approvals-submit-form.tsx uploads any number of bills and posts them as
     * `billUrls: string[]`. It does NOT send uploadBillUrl1/2 at all. This route previously read
     * only those two flat fields, so EVERY non-KIA submission silently lost all of its bills —
     * measured: the sole Hyundai request had 0 bills stored despite one being uploaded, while KIA
     * (which has its own route at app/api/brands/kia/approvals/route.ts, and which wins over this
     * dynamic segment) stored them on 86 of 122.
     *
     * The flat fields are still accepted because the signed-token re-submit flow can send that
     * older shape.
     *
     * The first two entries are mirrored back into upload_bill_url_1/2 because the approver UI, the
     * notification emails and the printed voucher read those columns — writing only the array would
     * hide the bills from the people approving the payment.
     */
    const normalizedBillUrls: string[] = (
      Array.isArray(billUrls) && billUrls.length
        ? billUrls
        : [uploadBillUrl1, uploadBillUrl2]
    )
      .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u: string) => u.trim())

    const [mirrorBill1 = null, mirrorBill2 = null] = normalizedBillUrls

    const emailCheck = validateEmailDomain(email)
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 })
    }

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
          .where(or(eq(glAccounts.appliesTo, 'both'), eq(glAccounts.appliesTo, normalizedBrand)))
          .orderBy(asc(glAccounts.glCode))
          .limit(1)

        if (fallbackGl.length > 0) {
          finalGlAccountId = fallbackGl[0].id
        }
      } catch (e) {
        console.warn('Fallback GL Account query error:', e)
      }
    }

    // Auto-save new vendor to common list if it doesn't already exist
    if (vendorName && vendorName.trim()) {
      const trimmedVendor = vendorName.trim()
      // Check if vendor exists case-insensitively
      const existing = await db
        .select({ id: approvalsCommonData.id })
        .from(approvalsCommonData)
        .where(
          and(
            eq(approvalsCommonData.category, 'vendor'),
            eq(approvalsCommonData.value, trimmedVendor)
          )
        )
        .limit(1)

      if (existing.length === 0) {
        try {
          await db.insert(approvalsCommonData).values({
            category: 'vendor',
            value: trimmedVendor,
            brand: 'all',
          })
        } catch (e) {
          // ignore conflicts or insert errors
          console.warn('Failed to insert new typed vendor:', e)
        }
      }
    }

    // Per-brand request number (KIA_0001). Allocated atomically — see the module for why a
    // single ON CONFLICT statement rather than MAX+1, given this endpoint is public intake.
    const requestNo = await allocateRequestNumber(normalizedBrand)

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
        brand: normalizedBrand,
        glAccountId: finalGlAccountId,
        gst: gst?.trim() || null,
        vehicleNumber: vehicleNumber?.trim() || null,
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
