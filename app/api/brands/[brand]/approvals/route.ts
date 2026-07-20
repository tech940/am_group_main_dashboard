import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { kiaApprovalRequests, approvalsCommonData } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

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
    if (!glAccountId) {
      return NextResponse.json({ error: 'GL Account is required' }, { status: 400 })
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
        brand: normalizedBrand,
        glAccountId: glAccountId,
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
