import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kiaApprovalRequests, glAccounts } from '@/lib/db/schema'
import { asc, eq, or } from 'drizzle-orm'

export async function POST(request: NextRequest) {
  try {
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
      glAccountId,
      gst,
    } = body

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email Address is required' }, { status: 400 })
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'A valid amount greater than 0 is required' }, { status: 400 })
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

    const [inserted] = await db
      .insert(kiaApprovalRequests)
      .values({
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
        uploadBillUrl1: uploadBillUrl1 || null,
        uploadBillUrl2: uploadBillUrl2 || null,
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
