import { NextRequest, NextResponse } from 'next/server'
import { desc, sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessAmFinance } from '@/lib/am-finance/access'
import { canViewAmFinance } from '@/lib/am-finance/access'
import { serializeAppDate } from '@/lib/date-time'
import { db } from '@/lib/db'
import { financeSheet } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

function normalizeDigits(value: string | null) {
  return String(value || '').replace(/\D/g, '')
}

function serializeDuplicateRow(row: typeof financeSheet.$inferSelect) {
  return {
    id: row.id,
    deliveryDate: row.deliveryDate,
    customerName: row.customerName,
    mobileNo: row.mobileNo,
    model: row.model,
    mainDealer: row.mainDealer,
    location: row.location,
    hyp: row.hyp,
    status: row.status,
    uploadedAt: serializeAppDate(row.uploadedAt),
  }
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Same rule as app/am-finance/page.tsx — honours an Access-Map allow AND a deny. Checking
    // the role alone served data to users the page had already refused. See lib/am-finance/access.ts.
    if (!(await canViewAmFinance(appUser))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const mobileDigits = normalizeDigits(request.nextUrl.searchParams.get('mobileNo'))
    const excludeId = Number(request.nextUrl.searchParams.get('excludeId') || 0)

    if (mobileDigits.length < 6) {
      return NextResponse.json({ rows: [] })
    }

    const mobileMatch = sql`regexp_replace(coalesce(${financeSheet.mobileNo}, ''), '\D', '', 'g') = ${mobileDigits}`
    const whereExpression = excludeId > 0
      ? sql`${mobileMatch} and ${financeSheet.id} <> ${excludeId}`
      : mobileMatch

    const rows = await db
      .select()
      .from(financeSheet)
      .where(whereExpression)
      .orderBy(desc(financeSheet.deliveryDate), desc(financeSheet.id))
      .limit(10)

    return NextResponse.json({ rows: rows.map(serializeDuplicateRow) })
  } catch (error) {
    console.error('Error in GET /api/am-finance/duplicates:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
