import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { approvalsCommonData, approvalsBranchesConfig } from '@/lib/db/schema'
import { eq, or, and } from 'drizzle-orm'
import { getBranchLabel } from '@/lib/branches'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand } = await context.params
    const normalizedBrand = String(brand || '').trim().toLowerCase()

    // 1. Get branch label/display name (e.g. "AM Kia")
    const brandDisplayName = getBranchLabel(normalizedBrand)

    // 2. Fetch locations configured for this brand
    const locations = await db
      .select({
        location: approvalsBranchesConfig.location,
        dealerCode: approvalsBranchesConfig.dealerCode,
        dealerName: approvalsBranchesConfig.dealerName,
      })
      .from(approvalsBranchesConfig)
      .where(eq(approvalsBranchesConfig.brand, normalizedBrand))

    // 3. Fetch approval types (matching brand or 'all')
    const typesRows = await db
      .select({ value: approvalsCommonData.value })
      .from(approvalsCommonData)
      .where(
        and(
          eq(approvalsCommonData.category, 'approval_type'),
          or(
            eq(approvalsCommonData.brand, normalizedBrand),
            eq(approvalsCommonData.brand, 'all')
          )
        )
      )
    const approvalTypes = Array.from(new Set(typesRows.map(r => r.value.trim()))).sort()

    // 4. Fetch vendors (matching brand or 'all')
    const vendorsRows = await db
      .select({ value: approvalsCommonData.value })
      .from(approvalsCommonData)
      .where(
        and(
          eq(approvalsCommonData.category, 'vendor'),
          or(
            eq(approvalsCommonData.brand, normalizedBrand),
            eq(approvalsCommonData.brand, 'all')
          )
        )
      )
    const vendors = Array.from(new Set(vendorsRows.map(r => r.value.trim()))).sort()

    return NextResponse.json({
      success: true,
      brand: normalizedBrand,
      brandDisplayName,
      locations,
      approvalTypes,
      vendors
    })
  } catch (error) {
    console.error('Error loading brand approvals configuration:', error)
    return NextResponse.json(
      {
        error: 'Failed to load brand approvals configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
