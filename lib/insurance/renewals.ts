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
import { getCrmRecords, type CrmDisposition } from '@/lib/insurance/crm'

export type RenewalBucket = '30' | '60' | '90' | 'lapsed' | 'lost'

export type UrgencySubBucket =
  | 'critical_7'   // 0 to 7 days
  | 'urgent_15'    // 8 to 15 days
  | 'standard_30'  // 16 to 30 days
  | 'upcoming_60'  // 31 to 60 days
  | 'upcoming_90'  // 61 to 90 days
  | 'lapsed_30'    // 1 to 30 days ago
  | 'lost_6m'      // 31 to 180 days ago

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
  urgencySubBucket: UrgencySubBucket
  lastPremium: number | null
  dealerCode: string | null
  // CRM tracking fields
  disposition?: CrmDisposition
  lossReason?: string | null
  competitorDestination?: string | null
  remarks?: string | null
  followUpDate?: string | null
  calledBy?: string | null
}

export type RenewalSummary = {
  critical7: number
  urgent15: number
  standard30: number
  upcoming30Total: number
  lapsed: number
  lost6m: number
  due30: number
  due60: number
  due90: number
  total: number
  premiumAtRisk: number
  premiumUpcoming30: number
}

export type BranchRenewalStats = {
  dealerCode: string
  brands: InsuranceBrandId[]
  critical7: number
  urgent15: number
  standard30: number
  lapsed: number
  lost6m: number
  due30: number
  due60: number
  due90: number
  total: number
  premiumAtRisk: number
  trend: number[]
}

export type RenewalPipeline = {
  generatedAt: string
  asOf: string
  summary: RenewalSummary
  branches: BranchRenewalStats[]
  rows: RenewalDue[]
  upcoming30Rows: RenewalDue[]
  lost6mRows: RenewalDue[]
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

function iso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

function optCol(brand: InsuranceBrand, key: InsuranceColumnKey, alias: string): string {
  const name = brand.columns[key]
  return name ? `${alias}.${name}` : 'NULL'
}

function bucketFor(days: number): RenewalBucket {
  if (days < -30) return 'lost'
  if (days < 0) return 'lapsed'
  if (days <= 30) return '30'
  if (days <= 60) return '60'
  return '90'
}

function urgencySubBucketFor(days: number): UrgencySubBucket {
  if (days < -30) return 'lost_6m'
  if (days < 0) return 'lapsed_30'
  if (days <= 7) return 'critical_7'
  if (days <= 15) return 'urgent_15'
  if (days <= 30) return 'standard_30'
  if (days <= 60) return 'upcoming_60'
  return 'upcoming_90'
}

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
      urgencySubBucket: urgencySubBucketFor(days),
      lastPremium: premium !== null && Number.isFinite(premium) ? premium : null,
      dealerCode: text(row.dealer_code),
    }]
  })
}

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
        dealerCode: key, brands: [], critical7: 0, urgent15: 0, standard30: 0,
        lapsed: 0, lost6m: 0, due30: 0, due60: 0, due90: 0,
        total: 0, premiumAtRisk: 0, trend: new Array(weeks).fill(0),
      }
      map.set(key, entry)
    }
    if (!entry.brands.includes(row.brand)) entry.brands.push(row.brand)
    entry.total += 1
    entry.premiumAtRisk += row.lastPremium ?? 0
    if (row.urgencySubBucket === 'critical_7') entry.critical7 += 1
    if (row.urgencySubBucket === 'urgent_15') entry.urgent15 += 1
    if (row.urgencySubBucket === 'standard_30') entry.standard30 += 1
    if (row.urgencySubBucket === 'lost_6m') entry.lost6m += 1
    if (row.bucket === 'lapsed') entry.lapsed += 1
    else if (row.bucket === '30') entry.due30 += 1
    else if (row.bucket === '60') entry.due60 += 1
    else if (row.bucket === '90') entry.due90 += 1

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
  const lapsedDays = opts.lapsedDays ?? 180 // Support 6 months of lapsed tracking
  const brandIds = opts.brands?.length ? opts.brands : (Object.keys(INSURANCE_BRANDS) as InsuranceBrandId[])

  const [perBrand, crmRecords] = await Promise.all([
    Promise.all(brandIds.map((id) => readBrand(id, opts.asOf, lookaheadDays, lapsedDays).catch(() => [] as RenewalDue[]))),
    getCrmRecords().catch(() => ({} as Record<string, any>)),
  ])

  const crmMap = crmRecords as Record<string, any>
  const byChassis = new Map<string, RenewalDue>()
  for (const row of perBrand.flat()) {
    const existing = byChassis.get(row.chassisNo)
    if (!existing || row.expiryDate > existing.expiryDate) {
      const crm = crmMap[row.chassisNo]
      const enrichedRow: RenewalDue = {
        ...row,
        disposition: crm?.disposition || 'PENDING',
        lossReason: crm?.lossReason || null,
        competitorDestination: crm?.competitorDestination || null,
        remarks: crm?.remarks || null,
        followUpDate: crm?.followUpDate || null,
        calledBy: crm?.calledBy || null,
      }
      byChassis.set(row.chassisNo, enrichedRow)
    }
  }
  const merged = [...byChassis.values()].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))

  const upcoming30Rows = merged.filter((r) => r.daysToExpiry >= 0 && r.daysToExpiry <= 30)
  const lost6mRows = merged.filter((r) => r.daysToExpiry >= -180 && r.daysToExpiry < 0)

  const critical7 = merged.filter((r) => r.urgencySubBucket === 'critical_7').length
  const urgent15 = merged.filter((r) => r.urgencySubBucket === 'urgent_15').length
  const standard30 = merged.filter((r) => r.urgencySubBucket === 'standard_30').length
  const lost6m = merged.filter((r) => r.daysToExpiry >= -180 && r.daysToExpiry < -30).length
  const lapsed = merged.filter((r) => r.daysToExpiry >= -30 && r.daysToExpiry < 0).length

  return {
    generatedAt: new Date().toISOString(),
    asOf: opts.asOf,
    branches: summariseBranches(merged, opts.asOf, lookaheadDays, lapsedDays),
    rows: merged,
    upcoming30Rows,
    lost6mRows,
    summary: {
      critical7,
      urgent15,
      standard30,
      upcoming30Total: upcoming30Rows.length,
      lapsed,
      lost6m,
      due30: merged.filter((r) => r.bucket === '30').length,
      due60: merged.filter((r) => r.bucket === '60').length,
      due90: merged.filter((r) => r.bucket === '90').length,
      total: merged.length,
      premiumAtRisk: Math.round(merged.reduce((sum, r) => sum + (r.lastPremium ?? 0), 0)),
      premiumUpcoming30: Math.round(upcoming30Rows.reduce((sum, r) => sum + (r.lastPremium ?? 0), 0)),
    },
  }
}
