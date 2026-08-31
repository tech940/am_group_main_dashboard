import 'server-only'

import { analyticsExecute } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { sql } from 'drizzle-orm'
import {
  brandOf, col, hasCol, insuranceSource, isOdExpr, activeRowsPredicate, esc,
  type InsuranceBrandId,
} from '@/lib/insurance/brands'
import {
  buildRelationship, segmentsFor, COVER_STATUS_LABEL,
  CONTINUOUS_COVER_WINDOW_DAYS, RENEWAL_DUE_WINDOW_DAYS, LOST_AFTER_DAYS,
  type InsuranceRelationship, type InsuranceSegment, type PolicyInput,
} from '@/lib/insurance-360/lifecycle'

/**
 * Reads the insurance relationship, per VEHICLE.
 *
 * ── The division of labour, and why it is drawn here ──────────────────────────────────────────
 * SQL computes PRIMITIVES only — counts, dates, and the gap between consecutive policies via LAG.
 * lib/insurance-360/lifecycle.ts owns every JUDGEMENT: what counts as a lapse, when a chain is
 * never-lapsed, which segment a vehicle falls in.
 *
 * The thresholds themselves are imported from that module and interpolated into the SQL, so the
 * numbers exist once. Re-typing `30` in a WHERE clause is how a card and the list beneath it end up
 * disagreeing, and this section has already been through that.
 *
 * ⚠️ Always read through `insuranceSource()`, never the bare table. Hyundai and Platinum APPEND a
 * new row each time a policy is re-uploaded rather than updating in place — 83 Platinum policies
 * carry 113 surplus rows that differ only in payment progress. Counting them inflates both the
 * policy count and the premium. `row_hash` does not protect against it.
 */

export type VehicleRelationshipRow = {
  chassisNo: string
  customerName: string | null
  registration: string | null
  model: string | null
  dealerCode: string | null
  relationship: InsuranceRelationship
  segments: InsuranceSegment[]
  statusLabel: string
}

export type InsuranceOverview = {
  vehicles: number
  policies: number
  activeCover: number
  dueForRenewal: number
  expired: number
  lapsed: number
  lost: number
  neverLapsed: number
  multiPolicy: number
  newPolicies: number
  renewalPolicies: number
  rolloverPolicies: number | null
  leftCensored: number
  /** Facts the UI must state rather than quietly omit. */
  caveats: string[]
}

/** Primitives per vehicle. No judgement — see the module note. */
function vehicleAggregateSql(brand: InsuranceBrandId) {
  const b = brandOf(brand)
  const src = insuranceSource(b, 't')
  const chassis = `UPPER(BTRIM(t.${col(b, 'chassisNo')}))`
  const start = `t.${col(b, 'policyStartDate')}`
  const expiry = `t.${col(b, 'odExpiryDate')}`
  const reg = hasCol(b, 'vehRegistNo') ? `t.${col(b, 'vehRegistNo')}` : `NULL::text`

  return `
    WITH od AS (
      SELECT ${chassis} AS chassis_no,
             t.${col(b, 'customerName')} AS customer_name,
             ${reg} AS registration,
             t.${col(b, 'modelName')} AS model,
             t.${col(b, 'dealerCode')} AS dealer_code,
             ${start} AS start_d,
             ${expiry} AS expiry_d,
             UPPER(BTRIM(COALESCE(t.${col(b, 'policyType')}, ''))) AS policy_type
      FROM ${src}
      WHERE COALESCE(BTRIM(t.${col(b, 'chassisNo')}), '') <> ''
        AND ${isOdExpr(b, 't')}
        AND ${activeRowsPredicate(b, 't')}
    ),
    seq AS (
      SELECT *,
             LAG(expiry_d) OVER (PARTITION BY chassis_no ORDER BY start_d, expiry_d) AS prev_expiry
      FROM od
    ),
    agg AS (
      SELECT chassis_no,
             COUNT(*)::int AS policy_count,
             MIN(start_d) AS first_start,
             MAX(start_d) AS latest_start,
             MAX(expiry_d) AS latest_expiry,
             COUNT(*) FILTER (WHERE policy_type = 'RENEWAL')::int AS renewal_count,
             COUNT(*) FILTER (WHERE policy_type = 'ROLLOVER')::int AS rollover_count,
             -- The gap that decides continuity. Negative gaps are overlaps, not breaks.
             MAX(GREATEST(start_d - prev_expiry, 0)) FILTER (WHERE prev_expiry IS NOT NULL)::int AS max_gap_days,
             (ARRAY_AGG(policy_type ORDER BY start_d, expiry_d))[1] AS first_type,
             (ARRAY_AGG(customer_name ORDER BY start_d DESC NULLS LAST))[1] AS customer_name,
             (ARRAY_AGG(registration ORDER BY start_d DESC NULLS LAST))[1] AS registration,
             (ARRAY_AGG(model ORDER BY start_d DESC NULLS LAST))[1] AS model,
             (ARRAY_AGG(dealer_code ORDER BY start_d DESC NULLS LAST))[1] AS dealer_code
      FROM seq GROUP BY chassis_no
    )
    SELECT *,
      (latest_expiry - CURRENT_DATE)::int AS days_to_expiry,
      -- Thresholds come from lifecycle.ts so the rule has one home; see the module note.
      (policy_count > 1 AND COALESCE(max_gap_days, 0) <= ${CONTINUOUS_COVER_WINDOW_DAYS}) AS never_lapsed,
      (first_type IN ('RENEWAL', 'ROLLOVER')) AS left_censored,
      CASE
        WHEN latest_expiry IS NULL THEN 'NO_COVER_ON_RECORD'
        WHEN (latest_expiry - CURRENT_DATE) < -${LOST_AFTER_DAYS} THEN 'LOST'
        WHEN (latest_expiry - CURRENT_DATE) < -${CONTINUOUS_COVER_WINDOW_DAYS} THEN 'LAPSED'
        WHEN (latest_expiry - CURRENT_DATE) < 0 THEN 'EXPIRED'
        WHEN (latest_expiry - CURRENT_DATE) <= ${RENEWAL_DUE_WINDOW_DAYS} THEN 'DUE_FOR_RENEWAL'
        ELSE 'ACTIVE'
      END AS status
    FROM agg`
}

/**
 * The §2 overview. ONE statement, and one ROW comes back.
 *
 * ⚠️ Counted in Postgres, not in JavaScript. The first version selected the per-vehicle aggregate and
 * did `rows.filter(...).length` a dozen times — which shipped all 12,775 Hyundai vehicles across the
 * pooler to produce fourteen integers, and measured **3,395ms**. Aggregating in the database returns
 * a single row. This is the same mistake that once moved 91.9 MB to compute a count of 1,318 in this
 * codebase; do not "simplify" it back into JS.
 */
export async function readInsuranceOverview(brand: InsuranceBrandId): Promise<InsuranceOverview> {
  return getCachedData(`insurance360:overview:v1:${brand}`, () => buildOverview(brand), CACHE_TTL.MEDIUM)
}

/*
 * Cached because the answer only changes when a feed is re-uploaded, and the window-function scan
 * over 26k Hyundai rows costs ~2.2s cold. Bump the v1 key when the RULES change — a stale entry
 * computed under a different lapse window would be silently wrong rather than merely old.
 */
async function buildOverview(brand: InsuranceBrandId): Promise<InsuranceOverview> {
  const b = brandOf(brand)
  const [agg] = await analyticsExecute<Record<string, unknown>>(sql.raw(`
    SELECT
      COUNT(*)::int AS vehicles,
      COALESCE(SUM(policy_count), 0)::int AS policies,
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_cover,
      COUNT(*) FILTER (WHERE status = 'DUE_FOR_RENEWAL')::int AS due_for_renewal,
      COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired,
      COUNT(*) FILTER (WHERE status = 'LAPSED')::int AS lapsed,
      COUNT(*) FILTER (WHERE status = 'LOST')::int AS lost,
      COUNT(*) FILTER (WHERE never_lapsed)::int AS never_lapsed,
      COUNT(*) FILTER (WHERE policy_count > 1)::int AS multi_policy,
      COUNT(*) FILTER (WHERE first_type = 'NEW')::int AS new_policies,
      COALESCE(SUM(renewal_count), 0)::int AS renewal_policies,
      COALESCE(SUM(rollover_count), 0)::int AS rollover_policies,
      COUNT(*) FILTER (WHERE left_censored)::int AS left_censored
    FROM (${vehicleAggregateSql(brand)}) v`))

  const n = (k: string) => Number(agg?.[k] ?? 0)
  const overview: InsuranceOverview = {
    vehicles: n('vehicles'),
    policies: n('policies'),
    activeCover: n('active_cover'),
    dueForRenewal: n('due_for_renewal'),
    expired: n('expired'),
    lapsed: n('lapsed'),
    lost: n('lost'),
    neverLapsed: n('never_lapsed'),
    multiPolicy: n('multi_policy'),
    newPolicies: n('new_policies'),
    renewalPolicies: n('renewal_policies'),
    // NULL, not 0. KIA's feed has no rollover value at all, and "0 rollovers" is a claim about the
    // business where "not recorded" is a claim about the data.
    rolloverPolicies: b.capabilities.hasRollover ? n('rollover_policies') : null,
    leftCensored: n('left_censored'),
    caveats: [],
  }

  if (overview.leftCensored > 0) {
    overview.caveats.push(
      `${overview.leftCensored.toLocaleString('en-IN')} vehicles show a renewal or rollover as their earliest policy — `
      + 'their relationship began before our records, so they are not counted as new.')
  }
  if (!b.capabilities.hasRollover) {
    overview.caveats.push('This feed carries no rollover classification, so rollover figures are unavailable rather than zero.')
  }
  if (!b.capabilities.hasLostCoverBucket) {
    overview.caveats.push('A full year of lapse is not yet reachable in this feed, so "Lost" cannot occur.')
  }
  if (!b.capabilities.hasCancelledFlag) {
    overview.caveats.push('This feed carries no cancellation flag, so premium and counts are gross of any cancelled policy.')
  }
  return overview
}

export type VehicleQuery = {
  segment?: InsuranceSegment | null
  search?: string | null
  limit?: number
  offset?: number
}

/**
 * The §4 table, one row per VEHICLE.
 *
 * Two statements: the filtered page of vehicles, then every policy belonging to that page so the
 * journey can be built. Fetching policies only for the visible page is what keeps this off a
 * whole-table read at ~225ms per pooler round trip.
 */
export async function readInsuranceVehicles(
  brand: InsuranceBrandId,
  query: VehicleQuery = {},
): Promise<{ rows: VehicleRelationshipRow[]; total: number }> {
  const b = brandOf(brand)
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const offset = Math.max(query.offset ?? 0, 0)

  const where: string[] = []
  if (query.search) {
    // Escaped and wrapped here; the value never reaches SQL unquoted.
    const term = esc(query.search.trim().toUpperCase())
    if (term) {
      where.push(`(chassis_no LIKE '%${term}%'
        OR UPPER(COALESCE(customer_name, '')) LIKE '%${term}%'
        OR UPPER(COALESCE(registration, '')) LIKE '%${term}%')`)
    }
  }
  const seg = query.segment
  if (seg === 'NEVER_LAPSED') where.push('never_lapsed')
  else if (seg === 'MULTI_POLICY') where.push('policy_count > 1')
  else if (seg === 'NEW') where.push(`first_type = 'NEW'`)
  else if (seg === 'RENEWAL') where.push('renewal_count > 0')
  else if (seg === 'ROLLOVER') where.push('rollover_count > 0')
  else if (seg === 'RETAINED') where.push(`policy_count > 1 AND status IN ('ACTIVE','DUE_FOR_RENEWAL')`)
  else if (seg) where.push(`status = '${esc(seg)}'`)

  const filtered = `SELECT * FROM (${vehicleAggregateSql(brand)}) v${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`

  const page = await analyticsExecute<Record<string, unknown>>(sql.raw(`
    SELECT *, COUNT(*) OVER ()::int AS total_rows
    FROM (${filtered}) f
    ORDER BY latest_expiry DESC NULLS LAST, chassis_no
    LIMIT ${limit} OFFSET ${offset}`))

  if (!page.length) return { rows: [], total: 0 }
  const total = Number(page[0].total_rows || 0)
  const chassisList = page.map((r) => String(r.chassis_no))

  // Every policy for the visible page — including third-party rows, so the reader can report the
  // row count honestly alongside the own-damage policy count.
  const src = insuranceSource(b, 't')
  const policies = await analyticsExecute<Record<string, unknown>>(sql.raw(`
    SELECT UPPER(BTRIM(t.${col(b, 'chassisNo')})) AS chassis_no,
           t.${col(b, 'policyNo')} AS policy_no,
           t.${col(b, 'policyStartDate')} AS start_d,
           t.${col(b, 'odExpiryDate')} AS expiry_d,
           t.${col(b, 'policyType')} AS policy_type,
           t.${col(b, 'insuranceCompany')} AS insurer,
           t.${col(b, 'grossPremium')}::text AS gross_premium,
           ${isOdExpr(b, 't')} AS is_od
    FROM ${src}
    WHERE UPPER(BTRIM(t.${col(b, 'chassisNo')})) IN (${chassisList.map((c) => `'${esc(c)}'`).join(', ')})
      AND ${activeRowsPredicate(b, 't')}`))

  const byChassis = new Map<string, PolicyInput[]>()
  for (const p of policies) {
    const key = String(p.chassis_no)
    byChassis.set(key, [...(byChassis.get(key) || []), {
      policyNo: p.policy_no as string | null,
      startDate: p.start_d as Date | string | null,
      expiryDate: p.expiry_d as Date | string | null,
      policyType: p.policy_type as string | null,
      insurer: p.insurer as string | null,
      grossPremium: p.gross_premium as string | null,
      isOwnDamage: p.is_od === true,
    }])
  }

  const today = new Date()
  const rows: VehicleRelationshipRow[] = page.map((r) => {
    const chassisNo = String(r.chassis_no)
    const relationship = buildRelationship(byChassis.get(chassisNo) || [], today)
    return {
      chassisNo,
      customerName: (r.customer_name as string | null) ?? null,
      registration: (r.registration as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      dealerCode: (r.dealer_code as string | null) ?? null,
      relationship,
      segments: segmentsFor(relationship),
      statusLabel: COVER_STATUS_LABEL[relationship.status],
    }
  })

  return { rows, total }
}

/** One vehicle's full journey, for the §5/§6 profile. */
export async function readVehicleJourney(
  brand: InsuranceBrandId,
  chassisNo: string,
): Promise<VehicleRelationshipRow | null> {
  const { rows } = await readInsuranceVehicles(brand, { search: chassisNo, limit: 5 })
  const exact = rows.find((r) => r.chassisNo === chassisNo.trim().toUpperCase())
  return exact ?? null
}
