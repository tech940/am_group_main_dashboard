import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rows(result: unknown) {
  return Array.isArray(result) ? result as Record<string, unknown>[] : []
}

function safeType(value: string | null) {
  if (value === 'insurance') return 'insurance'
  if (value === 'status') return 'status'
  return 'bank'
}

function safeGrouping(value: string | null) {
  if (value === 'yearly') return 'yearly'
  if (value === 'daily') return 'daily'
  return 'monthly'
}

export async function GET(request: NextRequest) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.proforma.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const type = safeType(searchParams.get('type'))
  const grouping = safeGrouping(searchParams.get('grouping'))
  const statusFilter = String(searchParams.get('status') || 'all')
  const top = searchParams.get('top') === '5' ? 5 : 1000
  const consultantFilter = String(searchParams.get('consultants') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const isBackOffice = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba', 'manager', 'accounts', 'viewer', 'service_manager', 'purchase_manager'].includes(appUser.role)
  const visibility = (await canApproveKiaProformaForUser(appUser, profile.approver)) || isBackOffice
    ? sql`TRUE`
    : sql`login_email = ${appUser.email}`
  const categoryExpression = type === 'insurance'
    ? sql`COALESCE(NULLIF(TRIM(insurance_company), ''), 'Unassigned Insurance')`
    : type === 'status'
      ? sql`COALESCE(NULLIF(TRIM(vehicle_status), ''), 'Unknown Status')`
      : sql`COALESCE(NULLIF(TRIM(bank_name), ''), 'Unassigned Bank')`
  const periodExpression = grouping === 'daily'
    ? sql`to_char(proforma_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`
    : grouping === 'yearly'
      ? sql`to_char(proforma_date AT TIME ZONE 'Asia/Kolkata', 'YYYY')`
      : sql`to_char(proforma_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`
  const statusExpression = statusFilter === 'all' ? sql`TRUE` : sql`vehicle_status = ${statusFilter}`
  const consultantExpression = consultantFilter.length === 0
    ? sql`TRUE`
    : sql`consultant IN (${sql.join(consultantFilter.map((consultant) => sql`${consultant}`), sql`, `)})`

  const [pivotRows, distributionRows, chartRows, consultantRows, modelRows, fuelRows, addressRows] = await Promise.all([
    db.execute(sql`
      WITH base AS (
        SELECT ${categoryExpression} AS category, ${periodExpression} AS period
        FROM kia_proformas
        WHERE deleted_at IS NULL AND ${visibility} AND ${statusExpression} AND ${consultantExpression}
      ),
      totals AS (
        SELECT category, COUNT(*)::int AS grand_total
        FROM base
        GROUP BY category
        ORDER BY grand_total DESC, category ASC
        LIMIT ${top}
      )
      SELECT base.category, base.period, COUNT(*)::int AS value, totals.grand_total
      FROM base
      JOIN totals ON totals.category = base.category
      GROUP BY base.category, base.period, totals.grand_total
      ORDER BY totals.grand_total DESC, base.category ASC, base.period ASC
    `),
    db.execute(sql`
      SELECT
        approval_status,
        vehicle_status,
        COUNT(*)::int AS total
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility} AND ${consultantExpression}
      GROUP BY approval_status, vehicle_status
    `),
    db.execute(sql`
      SELECT
        ${categoryExpression} AS category,
        ${periodExpression} AS period,
        COUNT(*)::int AS value
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility} AND ${statusExpression} AND ${consultantExpression}
      GROUP BY category, period
      ORDER BY period, category
    `),
    db.execute(sql`
      SELECT DISTINCT COALESCE(NULLIF(TRIM(consultant), ''), 'Unassigned Consultant') AS consultant
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility}
      ORDER BY consultant ASC
    `),
    db.execute(sql`
      SELECT COALESCE(NULLIF(TRIM(model_name), ''), 'Unassigned Model') AS name, COUNT(*)::int AS value
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility} AND ${consultantExpression}
      GROUP BY name
      ORDER BY value DESC, name ASC
      LIMIT 12
    `),
    db.execute(sql`
      SELECT COALESCE(NULLIF(TRIM(fuel_type), ''), 'Unknown Fuel') AS name, COUNT(*)::int AS value
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility} AND ${consultantExpression}
      GROUP BY name
      ORDER BY value DESC, name ASC
    `),
    db.execute(sql`
      SELECT
        CASE WHEN NULLIF(TRIM(customer_address), '') IS NULL THEN 'Missing Address' ELSE 'Address Captured' END AS name,
        COUNT(*)::int AS value
      FROM kia_proformas
      WHERE deleted_at IS NULL AND ${visibility} AND ${consultantExpression}
      GROUP BY name
      ORDER BY name ASC
    `),
  ])

  return NextResponse.json({
    pivot: rows(pivotRows),
    distributions: rows(distributionRows),
    chart: rows(chartRows),
    consultants: rows(consultantRows),
    modelDistribution: rows(modelRows),
    fuelDistribution: rows(fuelRows),
    addressIntegrity: rows(addressRows),
  })
}
