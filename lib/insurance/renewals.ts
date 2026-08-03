import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  INSURANCE_BRANDS,
  activeRowsPredicate,
  col,
  insuranceSource,
  isOdExpr,
  type InsuranceBrand,
  type InsuranceBrandId,
  type InsuranceColumnKey,
} from '@/lib/insurance/brands'

/**
 * Vehicles whose insurance is about to lapse — a WORK QUEUE, not a chart.
 *
 * ⚠️ A renewal event is an OWN-DAMAGE policy, not a row. Every car carries an OD policy AND a
 * fixed-premium third-party companion, plus one pair per year, so a 4-year-old vehicle holds ~7 rows
 * for 4 renewals. Counting rows here would put the same car in the queue several times and inflate
 * the pipeline. `isOdExpr` is the brand-specific discriminator that already encodes this
 * (hyundai/platinum: od_tenure <> '0'; kia: producttype = 'Addon').
 *
 * ⚠️ Read through `insuranceSource()`, never the raw table: the Hyundai and Platinum feeds append a
 * new row each time a policy is re-uploaded, so the raw table holds snapshot versions of one policy.
 *
 * "Due" means: the vehicle's LATEST own-damage policy expires inside the window, and no later policy
 * has been written for it. The second half is what stops an already-renewed car reappearing in the
 * queue — without it the list is mostly noise and the calling team stops trusting it.
 */

export type RenewalBucket = '30' | '60' | '90' | 'lapsed'

export type RenewalDue = {
  brand: InsuranceBrandId
  chassisNo: string
  registrationNo: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  insuranceCompany: string | null
  policyNo: string | null
  expiryDate: string
  daysToExpiry: number
  bucket: RenewalBucket
  lastPremium: number | null
  dealerCode: string | null
}

export type RenewalSummary = {
  lapsed: number
  due30: number
  due60: number
  due90: number
  total: number
  premiumAtRisk: number
}

/**
 * Per-branch rollup. Renewals are worked by the branch that sold the car, so the group total is not
 * an actionable number — it has to be split before anyone can be given a list.
 */
export type BranchRenewalStats = {
  dealerCode: string
  brands: InsuranceBrandId[]
  lapsed: number
  due30: number
  due60: number
  due90: number
  total: number
  premiumAtRisk: number
  /** Expiries per week across the window — the sparkline on the branch KPI card. */
  trend: number[]
}

export type RenewalPipeline = {
  generatedAt: string
  asOf: string
  summary: RenewalSummary
  branches: BranchRenewalStats[]
  rows: RenewalDue[]
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

/** Postgres DATE columns arrive as JS Date objects through this driver — String() gives "Thu Jul 30". */
function iso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/**
 * `col()` THROWS when a brand has no column for a key — correct for a surface that requires it, but
 * wrong here: this queue should degrade to a blank cell rather than 500 the whole page because one
 * feed lacks, say, a variant name. Returns a SQL fragment: the column, or literal NULL.
 */
function optCol(brand: InsuranceBrand, key: InsuranceColumnKey, alias: string): string {
  const name = brand.columns[key]
  return name ? `${alias}.${name}` : 'NULL'
}

function bucketFor(days: number): RenewalBucket {
  if (days < 0) return 'lapsed'
  if (days <= 30) return '30'
  if (days <= 60) return '60'
  return '90'
}

/**
 * One brand's due list. `lookaheadDays` bounds the future; `lapsedDays` how far back an expired
 * policy is still worth chasing (past that the customer has almost certainly bought elsewhere).
 */
async function readBrand(
  brandId: InsuranceBrandId,
  asOf: string,
  lookaheadDays: number,
  lapsedDays: number,
): Promise<RenewalDue[]> {
  const brand = INSURANCE_BRANDS[brandId]
  const expiryCol = col(brand, 'odExpiryDate')
  const chassisCol = col(brand, 'chassisNo')
  const source = insuranceSource(brand, 't')

  const result = await db.execute(sql`
    WITH od AS (
      SELECT
        NULLIF(BTRIM(t.${sql.raw(chassisCol)}), '') AS chassis_no,
        t.${sql.raw(expiryCol)}::date               AS expiry_date,
        ${sql.raw(optCol(brand, 'policyNo', 't'))}         AS policy_no,
        ${sql.raw(optCol(brand, 'customerName', 't'))}     AS customer_name,
        ${sql.raw(optCol(brand, 'vehRegistNo', 't'))}      AS registration_no,
        ${sql.raw(optCol(brand, 'modelName', 't'))}        AS model_name,
        ${sql.raw(optCol(brand, 'variantName', 't'))}      AS variant_name,
        ${sql.raw(optCol(brand, 'insuranceCompany', 't'))} AS insurance_company,
        ${sql.raw(optCol(brand, 'dealerCode', 't'))}       AS dealer_code,
        ${sql.raw(optCol(brand, 'netOdPremiumA', 't'))}::numeric AS premium
      FROM ${sql.raw(source)}
      WHERE ${sql.raw(isOdExpr(brand, 't'))}
        AND ${sql.raw(activeRowsPredicate(brand, 't'))}
        AND NULLIF(BTRIM(t.${sql.raw(chassisCol)}), '') IS NOT NULL
        AND t.${sql.raw(expiryCol)} IS NOT NULL
    ),
    latest AS (
      -- One row per vehicle: its most recent own-damage policy.
      SELECT DISTINCT ON (chassis_no) *
      FROM od
      ORDER BY chassis_no, expiry_date DESC
    )
    SELECT
      chassis_no, expiry_date::text AS expiry_date, policy_no, customer_name, registration_no,
      model_name, variant_name, insurance_company, dealer_code, premium::text AS premium,
      (expiry_date - ${asOf}::date)::int AS days_to_expiry
    FROM latest
    WHERE expiry_date <= (${asOf}::date + (${lookaheadDays} || ' days')::interval)
      AND expiry_date >= (${asOf}::date - (${lapsedDays} || ' days')::interval)
    ORDER BY expiry_date ASC
  `)

  return rows(result).flatMap((row) => {
    const expiry = iso(row.expiry_date)
    const chassis = text(row.chassis_no)
    if (!expiry || !chassis) return []
    const days = Number(row.days_to_expiry ?? 0)
    const premium = row.premium === null || row.premium === undefined ? null : Number(row.premium)
    return [{
      brand: brandId,
      chassisNo: chassis,
      registrationNo: text(row.registration_no),
      customerName: text(row.customer_name),
      model: text(row.model_name),
      variant: text(row.variant_name),
      insuranceCompany: text(row.insurance_company),
      policyNo: text(row.policy_no),
      expiryDate: expiry,
      daysToExpiry: days,
      bucket: bucketFor(days),
      lastPremium: premium !== null && Number.isFinite(premium) ? premium : null,
      dealerCode: text(row.dealer_code),
    }]
  })
}

/**
 * Rolls the merged queue up by dealer code. Computed in JS from rows already fetched — a second set
 * of grouped queries would double the cost of the page for numbers we can derive for free.
 *
 * Vehicles with no dealer code land under UNASSIGNED rather than being dropped: a car nobody owns is
 * exactly the one that goes uncalled, so it must stay visible.
 */
function summariseBranches(
  rows: RenewalDue[],
  asOf: string,
  lookaheadDays: number,
  lapsedDays: number,
): BranchRenewalStats[] {
  const WEEK_MS = 7 * 86_400_000
  const start = Date.parse(`${asOf}T00:00:00Z`) - lapsedDays * 86_400_000
  const weeks = Math.max(1, Math.ceil((lapsedDays + lookaheadDays) / 7))
  const map = new Map<string, BranchRenewalStats>()

  for (const row of rows) {
    const key = row.dealerCode || 'UNASSIGNED'
    let entry = map.get(key)
    if (!entry) {
      entry = {
        dealerCode: key, brands: [], lapsed: 0, due30: 0, due60: 0, due90: 0,
        total: 0, premiumAtRisk: 0, trend: new Array(weeks).fill(0),
      }
      map.set(key, entry)
    }
    if (!entry.brands.includes(row.brand)) entry.brands.push(row.brand)
    entry.total += 1
    entry.premiumAtRisk += row.lastPremium ?? 0
    if (row.bucket === 'lapsed') entry.lapsed += 1
    else if (row.bucket === '30') entry.due30 += 1
    else if (row.bucket === '60') entry.due60 += 1
    else entry.due90 += 1

    const slot = Math.floor((Date.parse(`${row.expiryDate}T00:00:00Z`) - start) / WEEK_MS)
    if (slot >= 0 && slot < weeks) entry.trend[slot] += 1
  }

  return [...map.values()]
    .map((b) => ({ ...b, premiumAtRisk: Math.round(b.premiumAtRisk) }))
    .sort((a, b) => b.total - a.total)
}

export async function getRenewalPipeline(opts: {
  asOf: string
  brands?: InsuranceBrandId[]
  lookaheadDays?: number
  lapsedDays?: number
}): Promise<RenewalPipeline> {
  const lookaheadDays = opts.lookaheadDays ?? 90
  const lapsedDays = opts.lapsedDays ?? 30
  const brandIds = opts.brands?.length ? opts.brands : (Object.keys(INSURANCE_BRANDS) as InsuranceBrandId[])

  const perBrand = await Promise.all(
    brandIds.map((id) => readBrand(id, opts.asOf, lookaheadDays, lapsedDays).catch(() => [] as RenewalDue[])),
  )

  // Hyundai and Platinum share 492 chassis. The same physical car must appear ONCE in a calling
  // queue, or two branches ring the same customer — keep the record with the later expiry.
  const byChassis = new Map<string, RenewalDue>()
  for (const row of perBrand.flat()) {
    const existing = byChassis.get(row.chassisNo)
    if (!existing || row.expiryDate > existing.expiryDate) byChassis.set(row.chassisNo, row)
  }
  const merged = [...byChassis.values()].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))

  return {
    generatedAt: new Date().toISOString(),
    asOf: opts.asOf,
    branches: summariseBranches(merged, opts.asOf, lookaheadDays, lapsedDays),
    rows: merged,
    summary: {
      lapsed: merged.filter((r) => r.bucket === 'lapsed').length,
      due30: merged.filter((r) => r.bucket === '30').length,
      due60: merged.filter((r) => r.bucket === '60').length,
      due90: merged.filter((r) => r.bucket === '90').length,
      total: merged.length,
      premiumAtRisk: Math.round(merged.reduce((sum, r) => sum + (r.lastPremium ?? 0), 0)),
    },
  }
}
