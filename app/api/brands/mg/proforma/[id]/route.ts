import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgProformas } from '@/lib/db/schema'
import { canApproveMgProformaForUser } from '@/lib/mg-proforma/access'
import { ensureMgUserProfile } from '@/lib/mg-proforma/server'
import { serializeUtcTimestampFields } from '@/lib/date-time'
import { saveMgProformaPdf } from '@/lib/mg-proforma/invoice'
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
    .from(mgProformas)
    .where(and(eq(mgProformas.id, id), isNull(mgProformas.deletedAt)))
    .limit(1)
  return row
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const accessResponse = await requireBrandApiAccess('mg')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const profile = await ensureMgUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isApprover = await canApproveMgProformaForUser(appUser, profile.approver)
    const { id } = await context.params
    const row = await getRow(id)
    if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })

    const ownsRow = row.loginEmail === appUser.email
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = text(body.action)
    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (action === 'finance') {
      const permission = await requirePermission(appUser, 'mg.proforma.edit')
      if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
      if (!isApprover && !ownsRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const remarks = text(body.financeRemarks)
      updates.financeStatus = text(body.financeStatus) || 'Pending'
      updates.financeRemarks = remarks || null
      updates.financeUpdatedTime = remarks || updates.financeStatus !== row.financeStatus ? new Date() : null
    } else if (action === 'approval') {
      const permission = await requirePermission(appUser, 'mg.proforma.approve')
      if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
      if (!isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const checks = (body.checks || {}) as Record<string, { status?: string; reason?: string }>
      const failures = VERIFY_FIELDS
        .map(([key, label]) => ({ label, status: text(checks[key]?.status), reason: text(checks[key]?.reason) }))
        .filter((item) => item.status === 'NOT APPROVED')
      if (failures.length > 0) {
        updates.approvalStatus = `NOT APPROVED | ${failures.map((item) => `${item.label} - ${item.reason || 'No reason specified'}`).join(' | ')}`
      } else {
        updates.approvalStatus = 'APPROVED'
        const pdfUrl = await saveMgProformaPdf(row)
        updates.linkPreview = pdfUrl || row.linkPreview || `/api/brands/mg/proforma/${id}/preview`
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
      .update(mgProformas)
      .set(updates)
      .where(eq(mgProformas.id, id))
      .returning()

    return NextResponse.json({ row: serialize(updated as Record<string, unknown>) })
  } catch (error) {
    console.error('Error in PATCH /api/brands/mg/proforma/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
