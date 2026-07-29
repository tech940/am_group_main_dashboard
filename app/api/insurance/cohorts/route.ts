import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { createDbGate } from '@/lib/db/concurrency'
import {
  FILTER_PARAM_COLUMNS,
  INSURANCE_BRANDS,
  col,
  esc,
  resolveBrand,
  supportedFilterParams,
  type InsuranceColumnKey,
} from '@/lib/insurance/brands'
import { buildCohortSql, mapCohortRows, GRACE_DAYS } from '@/lib/insurance/cohorts'

export const dynamic = 'force-dynamic'
// Two window-function passes over the policy table; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 60

const WINDOW_COUNT = 3

/**
 * Year-on-year / month-on-month cohort retention.
 *
 * "Of the vehicles whose first policy with us was a NEW policy in 2023, how many came back the
 * following year?" — answered per cohort period AND per originating policy type.
 *
 * Both grains are computed in one request (they share the table scan cost anyway and the client
 * toggles between them instantly), but concurrency-gated: see lib/db/concurrency.ts for why an
 * unbounded Promise.all against the production pooler stalls forever.
 */
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isSuperAdminRole(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Restricted to MD & Developer' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const brandId = resolveBrand(searchParams.get('type'))
    const brand = INSURANCE_BRANDS[brandId]

    // Same filter vocabulary as every other insurance route. Date filters are deliberately NOT
    // applied: a cohort analysis spans years by definition, and a date window would silently
    // truncate the very history it exists to measure.
    const conditions: string[] = ['1=1']
    const supported = new Set(supportedFilterParams(brand))
    for (const [param, key] of Object.entries(FILTER_PARAM_COLUMNS) as [string, InsuranceColumnKey][]) {
      if (!supported.has(param)) continue
      const value = searchParams.get(param)
      if (!value || value === 'all') continue
      conditions.push(`t.${col(brand, key)} = '${esc(value)}'`)
    }
    const scopeWhere = conditions.join(' AND ')

    const gate = createDbGate()
    const [yearRows, monthRows] = await Promise.all([
      gate(() => db.execute(sql.raw(buildCohortSql(brandId, scopeWhere, 'year', WINDOW_COUNT)))),
      gate(() => db.execute(sql.raw(buildCohortSql(brandId, scopeWhere, 'month', WINDOW_COUNT)))),
    ])

    const byYear = mapCohortRows(Array.isArray(yearRows) ? (yearRows as Record<string, unknown>[]) : [], WINDOW_COUNT)
    const byMonth = mapCohortRows(Array.isArray(monthRows) ? (monthRows as Record<string, unknown>[]) : [], WINDOW_COUNT)

    // Every originating type present, so the client's type filter is data-driven rather than a
    // hardcoded list — Kia has no ROLLOVER at all.
    const cohortTypes = Array.from(new Set(byYear.map((r) => r.cohortType))).sort()

    return NextResponse.json({
      brand: brandId,
      graceDays: GRACE_DAYS,
      windowCount: WINDOW_COUNT,
      cohortTypes,
      byYear,
      byMonth,
    })
  } catch (error) {
    console.error('[insurance:cohorts:error]', error)
    const message = error instanceof Error ? error.message : 'Failed to compute cohort retention'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
