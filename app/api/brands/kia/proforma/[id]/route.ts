import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas } from '@/lib/db/schema'
import { canApproveKiaProforma } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { serializeUtcTimestampFields } from '@/lib/date-time'
import { saveKiaProformaPdf } from '@/lib/kia-proforma/invoice'

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
    const isApprover = canApproveKiaProforma(appUser.role, profile.approver)
    const { id } = await context.params
    const row = await getRow(id)
    if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })

    const ownsRow = row.loginEmail === appUser.email
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = text(body.action)
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (action === 'finance') {
      if (!isApprover && !ownsRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const remarks = text(body.financeRemarks)
      updates.financeStatus = text(body.financeStatus) || 'Pending'
      updates.financeRemarks = remarks || null
      updates.financeUpdatedTime = remarks || updates.financeStatus !== row.financeStatus ? new Date() : null
    } else if (action === 'approval') {
      if (!isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const checks = (body.checks || {}) as Record<string, { status?: string; reason?: string }>
      const failures = VERIFY_FIELDS
        .map(([key, label]) => ({ label, status: text(checks[key]?.status), reason: text(checks[key]?.reason) }))
        .filter((item) => item.status === 'NOT APPROVED')
      if (failures.length > 0) {
        updates.approvalStatus = `NOT APPROVED | ${failures.map((item) => `${item.label} - ${item.reason || 'No reason specified'}`).join(' | ')}`
      } else {
        updates.approvalStatus = 'APPROVED'
        const pdfUrl = await saveKiaProformaPdf(row)
        updates.linkPreview = pdfUrl || row.linkPreview || `/api/brands/kia/proforma/${id}/preview`
      }
      updates.approvedBy = profile.consultantName || appUser.fullName || appUser.email
      updates.addDiscApproval = checks
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

    return NextResponse.json({ row: serialize(updated as Record<string, unknown>) })
  } catch (error) {
    console.error('Error in PATCH /api/brands/kia/proforma/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
