import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import {
  CANONICAL_COLUMN,
  FILTER_PARAM_COLUMNS,
  HISTORY_COLUMN_KEYS,
  INSURANCE_BRANDS,
  SEARCH_TERM_PATTERN,
  activeRowsPredicate,
  col,
  coverStatuses,
  esc,
  historyTables,
  isOdExprHist,
  policyTypeLiteral,
  premiumGuard,
  resolveBrand,
  selectList,
  supportedFilterParams,
  type InsuranceBrand,
  type InsuranceColumnKey,
} from '@/lib/insurance/brands'

export const dynamic = 'force-dynamic'
// Vercel kills a Node function at ~10s by default; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 60

/**
 * VEHICLE-BASED CUSTOMER RETENTION.  One row = one vehicle = one chassis_no.
 *
 * Replaces the old "Customer Analytics" query, which grouped by customer_name. That was wrong in
 * both directions: Hyundai holds 12,563 distinct chassis but only 8,443 distinct names, so name
 * grouping MERGED different vehicles under one name and SPLIT one vehicle across spelling variants.
 * chassis_no is 100% populated in both tables and is 17 valid VIN characters on every row.
 *
 * Two rules make the numbers mean what they say:
 *
 * 1. A RENEWAL EVENT IS AN OWN-DAMAGE POLICY, not a policy row. Vehicles carry two policies a year:
 *    an OD policy whose premium declines as NCB builds, and a fixed-premium third-party/CPA
 *    companion. `od_tenure <> '0'` separates them exactly (verified: od_tenure>0 <=> total_idv>0
 *    <=> basic_od_premium>0, zero disagreements in 38,525 rows). Counting raw rows would report one
 *    vehicle's 4 renewals as 7.
 *
 * 2. FILTERS PICK THE VEHICLES; HISTORY IS ALWAYS LIFETIME. The filter bar builds the `scope` CTE
 *    only. Every history number is computed over every policy we hold for that chassis, all years,
 *    all insurers, and across BOTH dealerships. This is not a nicety: with year=2026 applied, ~70%
 *    of the vehicles on screen are repeat customers whose prior history pre-group filtering erased —
 *    two in three rows would answer "did they come back?" with a false no.
 *
 * The both-tables union matters for the same reason. 492 chassis appear in both tables (zero shared
 * policy_no — N5203 and N5211 are the same group, and a car renews at one then the other). Computing
 * history per-table flags 375 vehicles as lost that hold live cover at the sister dealership.
 */

/** ORDER BY is never built from user input — only chosen from here. */
const SORTS: Record<string, string> = {
  renewals: 'renewal_events DESC, lifetime_gross_premium DESC',
  dueSoonest: 'last_od_expiry ASC NULLS LAST',
  longestLapsed: 'last_od_expiry ASC NULLS LAST',
  premium: 'lifetime_gross_premium DESC',
  recent: 'last_policy_date DESC NULLS LAST',
  switches: 'insurer_switches DESC',
  oldest: 'first_event_date ASC NULLS LAST',
}

/** The page filters, t.-prefixed so they work inside the `scope` CTE. */
function buildScopeWhere(brand: InsuranceBrand, p: URLSearchParams): string {
  const c: string[] = ['1=1']
  const issueDate = `t.${col(brand, 'policyIssueDate')}`
  const startDate = p.get('startDate')
  const endDate = p.get('endDate')
  const year = p.get('year')

  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) c.push(`${issueDate} >= '${startDate}'`)
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) c.push(`${issueDate} <= '${endDate}'`)
  if (year && year !== 'all' && /^\d{4}$/.test(year)) c.push(`date_part('year', ${issueDate}) = ${parseInt(year, 10)}`)

  const supported = new Set(supportedFilterParams(brand))
  for (const [param, key] of Object.entries(FILTER_PARAM_COLUMNS) as [string, InsuranceColumnKey][]) {
    if (!supported.has(param)) continue
    const v = p.get(param)
    if (v && v !== 'all') c.push(`t.${col(brand, key)} = '${esc(v)}'`)
  }

  // Cancelled policies leave the cohort entirely, not just the cover status: 11 of KIA's 17
  // cancelled VINs also hold a live policy, and most were cancelled and re-booked the same day with
  // the same insurer. Counting both halves would inflate repeat vehicles. No-op for the other brands.
  c.push(activeRowsPredicate(brand, 't'))
  return c.join(' AND ')
}

/**
 * Filters on DERIVED columns. These cannot live in the scope WHERE — they only exist after the
 * whole CTE chain has run — so they are applied to the final `vehicle` relation.
 */
function buildVehicleWhere(brand: InsuranceBrand, p: URLSearchParams): string {
  const c: string[] = ['TRUE']

  const behaviour = p.get('behaviour')
  if (behaviour === 'repeat') c.push('is_repeat_vehicle')
  else if (behaviour === 'single') c.push('renewal_events = 1')
  else if (behaviour === 'wonback') c.push('was_won_back')

  // Validated against the buckets this brand can actually reach — KIA's earliest expiry is in the
  // future, so LOST is structurally unreachable and must not be offered or accepted.
  const cover = p.get('coverStatus')
  if (cover && (coverStatuses(brand) as readonly string[]).includes(cover)) c.push(`cover_status = '${cover}'`)

  if (p.get('ownerChanged') === '1') c.push('owner_changed')
  if (p.get('switchedInsurer') === '1') c.push('switched_insurer')
  if (p.get('crossDealer') === '1' && brand.capabilities.hasCrossDealerHistory) c.push('also_at_other_dealer')

  // Free text is the one place a user string reaches the SQL, so it is validated against a
  // conservative charset BEFORE interpolation rather than relying on quote-doubling.
  const raw = (p.get('search') || '').trim()
  if (raw && SEARCH_TERM_PATTERN.test(raw)) {
    const term = esc(raw)
    const upper = esc(raw.toUpperCase())
    // Registration is stored inconsistently (JK20.3937 and JK203937 both occur), so match on a
    // punctuation-stripped form as well as the literal.
    const regNorm = esc(raw.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    const parts = [
      `chassis_no ILIKE '%${term}%'`,
      `current_owner ILIKE '%${term}%'`,
      `previous_owner ILIKE '%${term}%'`,
    ]
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(raw.toUpperCase())) parts.unshift(`chassis_no = '${upper}'`)
    // KIA's veh_regist_no is empty on all 1,366 rows, so this arm would never match — drop it
    // rather than leave a search clause that silently contributes nothing.
    if (regNorm && brand.capabilities.hasRegistration) {
      parts.push(`regexp_replace(upper(veh_regist_no), '[^A-Z0-9]', '', 'g') LIKE '%${regNorm}%'`)
    }
    c.push(`(${parts.join(' OR ')})`)
  }

  return c.join(' AND ')
}

/**
 * The shared CTE chain. Both the list and the KPI query run it; only the final SELECT differs, so
 * the cards can never disagree with the rows.
 *
 * @param withJourney the per-event chip strip costs ~230ms on the unfiltered Hyundai query, so the
 *   KPI query omits it.
 */
function buildCte(brand: InsuranceBrand, scopeWhere: string, withJourney: boolean): string {
  const NAME_KEY = (col: string) =>
    `regexp_replace(regexp_replace(' '||regexp_replace(upper(${col}),'[^A-Z]',' ','g')||' ', ` +
    `' (?:MR|MRS|MS|SH|SHRI|SMT|DR|[A-Z])(?= )','','g'),'[^A-Z]','','g')`

  // Every arm aliases to CANONICAL names and fills absent columns with NULL, so downstream CTEs
  // reference one vocabulary regardless of brand and every UNION arm has identical arity.
  const histArms = historyTables(brand)
    .map(
      (t, i) =>
        `  SELECT ${selectList(t.id, HISTORY_COLUMN_KEYS, { fillAbsentWithNull: true })}, ` +
        `${i + 1} AS src_rank, '${t.id}'::text AS src FROM ${t.table}`,
    )
    .join('\n  UNION ALL\n')

  return `
WITH scope AS (
  SELECT t.${col(brand, 'chassisNo')} AS chassis_no, COUNT(*)::int AS scope_policies
  FROM ${brand.table} t
  WHERE ${scopeWhere}
  GROUP BY t.${col(brand, 'chassisNo')}
),
hist_all AS (
${histArms}
),
n AS (
  SELECT h.*,
    NULLIF(btrim(h.veh_regist_no),'') AS reg,
    ${premiumGuard(brand, `h.${CANONICAL_COLUMN.grossPremium}`)} AS gp,
    ${isOdExprHist(brand, 'h')} AS is_od
  FROM hist_all h JOIN scope s ON s.chassis_no = h.chassis_no
),
row_agg AS (
  SELECT chassis_no,
    COUNT(*)::int AS total_policy_rows,
    COUNT(*) FILTER (WHERE is_od)::int AS renewal_events,
    COUNT(*) FILTER (WHERE NOT is_od)::int AS tp_only_policies,
    COALESCE(SUM(gp),0) AS lifetime_gross_premium,
    MAX(policy_start_date) AS last_policy_date,
    MIN(policy_start_date) FILTER (WHERE is_od) AS first_event_date,
    MAX(od_expiry_date) FILTER (WHERE is_od) AS last_od_expiry,
    MAX(model_name) AS model_name, MAX(variant_name) AS variant_name,
    MAX(fuel_type) AS fuel_type, MAX(mfg_year) AS mfg_year,
    BOOL_OR(src='hyundai') AS at_hyundai, BOOL_OR(src='platinum') AS at_platinum,
    MIN(customer_name) AS nm_min, MAX(customer_name) AS nm_max
  FROM n GROUP BY chassis_no
),
name_chk AS (
  -- Runs the normaliser only where the RAW names already differ (~900 rows), then compares
  -- MIN vs MAX of the normalised key — "more than one distinct value" without a COUNT(DISTINCT).
  SELECT x.chassis_no, (MIN(x.owner_key) IS DISTINCT FROM MAX(x.owner_key)) AS owner_changed
  FROM (
    SELECT n.chassis_no, ${NAME_KEY('n.customer_name')} AS owner_key
    FROM n JOIN row_agg ra ON ra.chassis_no = n.chassis_no
    WHERE ra.nm_min IS DISTINCT FROM ra.nm_max
  ) x GROUP BY x.chassis_no
),
cur_row AS (
  SELECT DISTINCT ON (chassis_no) chassis_no, customer_name AS current_owner
  FROM n ORDER BY chassis_no, policy_start_date DESC, src_rank DESC, id DESC
),
prev_owner AS (
  SELECT DISTINCT ON (y.chassis_no) y.chassis_no, y.customer_name AS previous_owner
  FROM (
    SELECT n.chassis_no, n.customer_name, n.policy_start_date, n.src_rank, n.id,
      ${NAME_KEY('n.customer_name')} AS ok,
      ${NAME_KEY('cr.current_owner')} AS cok
    FROM n JOIN name_chk nc ON nc.chassis_no = n.chassis_no AND nc.owner_changed
           JOIN cur_row cr ON cr.chassis_no = n.chassis_no
  ) y WHERE y.ok IS DISTINCT FROM y.cok
  ORDER BY y.chassis_no, y.policy_start_date DESC, y.src_rank DESC, y.id DESC
),
cur_reg AS (
  SELECT DISTINCT ON (chassis_no) chassis_no, reg FROM n WHERE reg IS NOT NULL
  ORDER BY chassis_no, policy_start_date DESC, src_rank DESC, id DESC
),
ev AS (
  SELECT chassis_no, id, src_rank, src, policy_start_date, od_expiry_date,
         insurance_company, policy_type, total_idv, current_ncb_percentage,
         LAG(od_expiry_date) OVER w AS prev_exp,
         LAG(insurance_company) OVER w AS prev_ins
  FROM n WHERE is_od
  WINDOW w AS (PARTITION BY chassis_no ORDER BY policy_start_date, id, src_rank)
),
ev_agg AS (
  SELECT chassis_no,
    COUNT(DISTINCT insurance_company)::int AS distinct_insurers,
    COUNT(*) FILTER (WHERE prev_ins IS NOT NULL AND insurance_company <> prev_ins)::int AS insurer_switches,
    -- "Won back" = cover actually lapsed more than 30 days before the next policy started.
    -- 93.8% of renewals start exactly 1 day after the previous expiry, so 30 days sits in a
    -- genuine trough rather than clipping ordinary paperwork delay.
    COUNT(*) FILTER (WHERE prev_exp IS NOT NULL AND policy_start_date > prev_exp + 30)::int AS won_back_count,
    MAX(policy_start_date - prev_exp) FILTER (WHERE prev_exp IS NOT NULL) AS max_gap_days${withJourney ? `,
    jsonb_agg(jsonb_build_object(
      'y', to_char(policy_start_date,'YY'),
      'type', policy_type,
      'ins', insurance_company,
      'gap', CASE WHEN prev_exp IS NOT NULL AND policy_start_date > prev_exp + 30
                  THEN (policy_start_date - prev_exp) ELSE 0 END,
      'src', src
    ) ORDER BY policy_start_date, id, src_rank) AS journey` : ''}
  FROM ev GROUP BY chassis_no
),
ev_first AS (
  SELECT DISTINCT ON (chassis_no) chassis_no, policy_type AS first_event_type
  FROM ev ORDER BY chassis_no, policy_start_date, id, src_rank
),
ev_last AS (
  -- Current attributes come from the latest OD-BEARING policy, never the latest raw row: the
  -- third-party companion routinely names a different insurer than the OD policy that year.
  SELECT DISTINCT ON (chassis_no) chassis_no,
         insurance_company AS current_insurer, total_idv AS current_idv,
         current_ncb_percentage AS current_ncb
  FROM ev ORDER BY chassis_no, policy_start_date DESC, id DESC, src_rank DESC
),
vehicle AS (
  SELECT
    a.chassis_no, COALESCE(cg.reg,'') AS veh_regist_no,
    a.model_name, a.variant_name, a.fuel_type, a.mfg_year,
    cr.current_owner, po.previous_owner, COALESCE(nc.owner_changed,FALSE) AS owner_changed,
    a.renewal_events, a.tp_only_policies, a.total_policy_rows,
    (a.renewal_events > 1) AS is_repeat_vehicle,
    a.first_event_date, ef.first_event_type,
    -- A first observed policy typed RENEWAL/ROLLOVER proves cover existed before our data starts
    -- (27 Dec 2022). 60% of Hyundai vehicles are in this state, so "first seen" is never "first ever".
    (ef.first_event_type IS NOT NULL AND ef.first_event_type <> '${policyTypeLiteral(brand, 'new')}') AS history_left_censored,
    a.last_policy_date,
    a.last_od_expiry, (a.last_od_expiry - CURRENT_DATE) AS days_to_expiry,
    -- Lapse is judged on od_expiry_date only. A start_date + 365 rule would flag the 25 three-year
    -- OD policies in each table as churned.
    CASE
      WHEN a.last_od_expiry IS NULL               THEN 'TP_ONLY'
      WHEN a.last_od_expiry <  CURRENT_DATE - 365 THEN 'LOST'
      WHEN a.last_od_expiry <  CURRENT_DATE       THEN 'LAPSED'
      WHEN a.last_od_expiry <= CURRENT_DATE + 30  THEN 'EXPIRING_30'
      WHEN a.last_od_expiry <= CURRENT_DATE + 90  THEN 'EXPIRING_90'
      ELSE 'ACTIVE' END AS cover_status,
    COALESCE(e.insurer_switches,0) AS insurer_switches,
    (COALESCE(e.insurer_switches,0) > 0) AS switched_insurer,
    el.current_insurer, el.current_idv, el.current_ncb,
    COALESCE(e.won_back_count,0) AS won_back_count,
    (COALESCE(e.won_back_count,0) > 0) AS was_won_back,
    e.max_gap_days,${withJourney ? ' e.journey,' : ''}
    a.lifetime_gross_premium,
    (a.at_hyundai AND a.at_platinum) AS also_at_other_dealer,
    s.scope_policies
  FROM row_agg a
  JOIN scope s ON s.chassis_no = a.chassis_no
  JOIN cur_row cr ON cr.chassis_no = a.chassis_no
  LEFT JOIN name_chk nc ON nc.chassis_no = a.chassis_no
  LEFT JOIN prev_owner po ON po.chassis_no = a.chassis_no
  LEFT JOIN cur_reg cg ON cg.chassis_no = a.chassis_no
  LEFT JOIN ev_agg e ON e.chassis_no = a.chassis_no
  LEFT JOIN ev_first ef ON ef.chassis_no = a.chassis_no
  LEFT JOIN ev_last el ON el.chassis_no = a.chassis_no
)`
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

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

    const scopeWhere = buildScopeWhere(brand, searchParams)
    const vehicleWhere = buildVehicleWhere(brand, searchParams)
    const orderBy = `${SORTS[searchParams.get('sort') || ''] || SORTS.renewals}, chassis_no ASC`
    const pageSize = Math.min(100, Math.max(10, num(searchParams.get('pageSize')) || 50))
    const page = Math.max(1, num(searchParams.get('page')) || 1)
    const offset = (page - 1) * pageSize

    // One transaction so `SET LOCAL work_mem` actually applies. Measured: the unfiltered Hyundai
    // query spills to disk at the default and takes 2,318ms; at 64MB it is 765ms.
    const { rows, kpis } = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL work_mem = '64MB'`))

      const listRes = await tx.execute(sql.raw(`
        ${buildCte(brand, scopeWhere, true)}
        SELECT *, COUNT(*) OVER () AS total_count
        FROM vehicle
        WHERE ${vehicleWhere}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      `))

      // KPIs come from the full cohort, never from the returned page — that is exactly why the old
      // "Total Customers" card read a flat 500 (it counted an array the server had capped).
      const kpiRes = await tx.execute(sql.raw(`
        ${buildCte(brand, scopeWhere, false)}
        SELECT
          COUNT(*)::int AS vehicles_in_scope,
          COALESCE(SUM(scope_policies),0)::int AS policies_in_scope,
          COUNT(*) FILTER (WHERE renewal_events > 0)::int AS vehicles_with_od,
          COUNT(*) FILTER (WHERE is_repeat_vehicle)::int AS repeat_vehicles,
          ROUND(100.0 * COUNT(*) FILTER (WHERE is_repeat_vehicle)
                / NULLIF(COUNT(*) FILTER (WHERE renewal_events > 0),0), 1) AS retention_pct,
          COUNT(*) FILTER (WHERE renewal_events = 1)::int AS single_event_vehicles,
          COUNT(*) FILTER (WHERE was_won_back)::int AS won_back,
          COUNT(*) FILTER (WHERE cover_status IN ('LAPSED','LOST'))::int AS expired_not_renewed,
          COUNT(*) FILTER (WHERE cover_status = 'EXPIRING_30')::int AS expiring_30,
          COUNT(*) FILTER (WHERE cover_status = 'EXPIRING_90')::int AS expiring_90,
          COUNT(*) FILTER (WHERE cover_status = 'ACTIVE')::int AS st_active,
          COUNT(*) FILTER (WHERE cover_status = 'LAPSED')::int AS st_lapsed,
          COUNT(*) FILTER (WHERE cover_status = 'LOST')::int AS st_lost,
          COUNT(*) FILTER (WHERE cover_status = 'TP_ONLY')::int AS st_tp_only,
          COUNT(*) FILTER (WHERE switched_insurer)::int AS switched_insurer,
          COUNT(*) FILTER (WHERE owner_changed)::int AS owner_name_differs,
          COUNT(*) FILTER (WHERE history_left_censored)::int AS pre_window_history,
          COUNT(*) FILTER (WHERE also_at_other_dealer)::int AS also_at_other_dealer,
          COALESCE(SUM(lifetime_gross_premium),0) AS lifetime_gross_premium
        FROM vehicle
        WHERE ${vehicleWhere}
      `))

      return {
        rows: (Array.isArray(listRes) ? listRes : []) as Record<string, unknown>[],
        kpis: ((Array.isArray(kpiRes) ? kpiRes[0] : {}) || {}) as Record<string, unknown>,
      }
    })

    const total = rows.length ? num(rows[0].total_count) : 0

    return NextResponse.json({
      rows: rows.map((r) => ({
        chassisNo: String(r.chassis_no || ''),
        vehRegistNo: String(r.veh_regist_no || ''),
        modelName: String(r.model_name || ''),
        variantName: String(r.variant_name || ''),
        fuelType: String(r.fuel_type || ''),
        mfgYear: String(r.mfg_year || ''),
        currentOwner: String(r.current_owner || ''),
        previousOwner: r.previous_owner ? String(r.previous_owner) : null,
        ownerChanged: Boolean(r.owner_changed),
        renewalEvents: num(r.renewal_events),
        tpOnlyPolicies: num(r.tp_only_policies),
        totalPolicyRows: num(r.total_policy_rows),
        isRepeatVehicle: Boolean(r.is_repeat_vehicle),
        firstEventDate: r.first_event_date ? String(r.first_event_date) : null,
        historyLeftCensored: Boolean(r.history_left_censored),
        lastPolicyDate: r.last_policy_date ? String(r.last_policy_date) : null,
        lastOdExpiry: r.last_od_expiry ? String(r.last_od_expiry) : null,
        daysToExpiry: r.days_to_expiry === null || r.days_to_expiry === undefined ? null : num(r.days_to_expiry),
        coverStatus: String(r.cover_status || ''),
        insurerSwitches: num(r.insurer_switches),
        switchedInsurer: Boolean(r.switched_insurer),
        currentInsurer: String(r.current_insurer || ''),
        wonBackCount: num(r.won_back_count),
        wasWonBack: Boolean(r.was_won_back),
        maxGapDays: r.max_gap_days === null || r.max_gap_days === undefined ? null : num(r.max_gap_days),
        journey: Array.isArray(r.journey) ? r.journey : [],
        lifetimeGrossPremium: num(r.lifetime_gross_premium),
        alsoAtOtherDealer: Boolean(r.also_at_other_dealer),
        scopePolicies: num(r.scope_policies),
      })),
      kpis: {
        vehiclesInScope: num(kpis.vehicles_in_scope),
        policiesInScope: num(kpis.policies_in_scope),
        vehiclesWithOd: num(kpis.vehicles_with_od),
        repeatVehicles: num(kpis.repeat_vehicles),
        retentionPct: num(kpis.retention_pct),
        singleEventVehicles: num(kpis.single_event_vehicles),
        wonBack: num(kpis.won_back),
        expiredNotRenewed: num(kpis.expired_not_renewed),
        expiring30: num(kpis.expiring_30),
        expiring90: num(kpis.expiring_90),
        stActive: num(kpis.st_active),
        stLapsed: num(kpis.st_lapsed),
        stLost: num(kpis.st_lost),
        stTpOnly: num(kpis.st_tp_only),
        switchedInsurer: num(kpis.switched_insurer),
        ownerNameDiffers: num(kpis.owner_name_differs),
        preWindowHistory: num(kpis.pre_window_history),
        alsoAtOtherDealer: num(kpis.also_at_other_dealer),
        lifetimeGrossPremium: num(kpis.lifetime_gross_premium),
      },
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      brand: brandId,
      capabilities: brand.capabilities,
      coverStatuses: coverStatuses(brand),
    })
  } catch (error) {
    console.error('Insurance vehicles query failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load vehicle retention' },
      { status: 500 },
    )
  }
}
