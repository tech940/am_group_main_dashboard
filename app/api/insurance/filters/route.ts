import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import {
  INSURANCE_BRANDS,
  col,
  hasCol,
  resolveBrand,
  type InsuranceColumnKey,
  insuranceSource,} from '@/lib/insurance/brands'
import { createDbGate, mapWithConcurrency } from '@/lib/db/concurrency'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Dropdown option lists, per brand.
 *
 * Columns are resolved through the brand map rather than hardcoded, because the three feeds do not
 * share a vocabulary — kia_insurance calls model `model`, policy_type `policytype`, and simply has
 * no sub_user / rm_name / dp_name / column_64vb_status at all.
 *
 * A brand that lacks a column has that query SKIPPED and returns [] — never queried and never
 * zero-filled. The client hides the corresponding dropdown; an option list that renders but matches
 * nothing is indistinguishable from a broken filter.
 *
 * Every query aliases back to the CANONICAL (Hyundai) name. The mappers below read `r.model_name`,
 * so a KIA query selecting `model` without `AS model_name` would yield a dropdown full of the
 * literal string "undefined" — populated-looking and completely wrong.
 */

/** responseKey -> the column it reads, and the canonical alias the mapper expects. */
const OPTION_QUERIES: Array<{ key: string; column: InsuranceColumnKey }> = [
  { key: 'dealerCodes', column: 'dealerCode' },
  { key: 'subUsers', column: 'subUser' },
  { key: 'insuranceCompanies', column: 'insuranceCompany' },
  { key: 'executives', column: 'rmName' },
  { key: 'dpNames', column: 'dpName' },
  { key: 'models', column: 'modelName' },
  { key: 'policyTypes', column: 'policyType' },
  { key: 'fuelTypes', column: 'fuelType' },
  { key: 'paymentModes', column: 'paymentMode' },
  { key: 'statuses', column: 'column64vbStatus' },
]

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!canViewRestrictedAnalytics(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Restricted access' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const brandId = resolveBrand(searchParams.get('type'))
    const brand = INSURANCE_BRANDS[brandId]
    const tableName = insuranceSource(brand)

    // Only the columns this brand actually has. `dealerCode` survives even when single-valued —
    // the client decides whether a one-option dropdown is worth showing.
    const live = OPTION_QUERIES.filter((q) => hasCol(brand, q.column))

    // ⚠️ CONCURRENCY IS CAPPED — see lib/db/concurrency.ts. Up to 11 DISTINCT scans over the same
    // table used to fire at once. That is fine locally (dev uses session mode on :5432) and stalls
    // in production, which goes through the transaction pooler's small shared server pool.
    const results = await mapWithConcurrency([
      ...live.map((q) => () =>
        db.execute(
          sql.raw(
            `SELECT DISTINCT ${col(brand, q.column)} AS value FROM ${tableName} ` +
              `WHERE ${col(brand, q.column)} IS NOT NULL AND ${col(brand, q.column)} != '' ` +
              `ORDER BY value ASC`,
          ),
        ),
      ),
      () =>
        db.execute(
          sql.raw(
            `SELECT DISTINCT date_part('year', ${col(brand, 'policyIssueDate')})::int as yr ` +
              `FROM ${tableName} WHERE ${col(brand, 'policyIssueDate')} IS NOT NULL ORDER BY yr DESC`,
          ),
        ),
    ])

    const years = results[results.length - 1] as Record<string, unknown>[]

    // Absent columns resolve to [] here, which is what the client keys "hide this dropdown" off.
    const payload: Record<string, string[] | number[]> = Object.fromEntries(
      OPTION_QUERIES.map((q) => [q.key, [] as string[]]),
    )
    live.forEach((q, i) => {
      const rows = results[i] as Record<string, unknown>[]
      payload[q.key] = rows.map((r) => String(r.value)).filter(Boolean)
    })

    return NextResponse.json({
      ...payload,
      years: years.map((r) => Number(r.yr)).filter((y) => !Number.isNaN(y)),
      brand: brandId,
      capabilities: brand.capabilities,
    })
  } catch (error) {
    console.error('[insurance:filters:error]', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch insurance filters'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
