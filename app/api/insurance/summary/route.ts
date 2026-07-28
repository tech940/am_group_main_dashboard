import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import {
  FILTER_PARAM_COLUMNS,
  INSURANCE_BRANDS,
  col,
  esc,
  hasCol,
  policyTypeLiteral,
  premiumAvg,
  premiumExpr,
  premiumSum,
  resolveBrand,
  supportedFilterParams,
  type InsuranceColumnKey,
} from '@/lib/insurance/brands'

export const dynamic = 'force-dynamic'

function safeNum(val: any): number {
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isSuperAdminRole(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Restricted to MD & Developer' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const brandId = resolveBrand(searchParams.get('type'))
    const brand = INSURANCE_BRANDS[brandId]
    const tableName = brand.table

    // Short aliases so the SQL below stays readable. Every one resolves through the brand map: the
    // three feeds share no column vocabulary, and kia_insurance stores premiums as NUMERIC where the
    // other two store TEXT — applying the TEXT regex guard to a numeric column raises 42883 at PARSE
    // time, which would take all 15 queries in this one Promise.all down together.
    const C = (k: InsuranceColumnKey) => col(brand, k)
    const GROSS = premiumExpr(brand, 'grossPremium')
    const NET = premiumExpr(brand, 'netPremium')
    const SUM_GROSS = premiumSum(brand, 'grossPremium')
    const SUM_NET = premiumSum(brand, 'netPremium')
    const AVG_GROSS = premiumAvg(brand, 'grossPremium')
    const PT_RENEWAL = policyTypeLiteral(brand, 'renewal')
    const PT_NEW = policyTypeLiteral(brand, 'new')
    const PT_ROLLOVER = brand.capabilities.hasRollover ? policyTypeLiteral(brand, 'rollover') : null

    /** SUM of a premium-shaped column, or the literal 0 when this brand has no such column. */
    const sumOr0 = (k: InsuranceColumnKey) => (hasCol(brand, k) ? premiumSum(brand, k) : '0')
    /** SUM of an already-numeric column, or 0 when absent. */
    const numSumOr0 = (k: InsuranceColumnKey) => (hasCol(brand, k) ? `COALESCE(SUM(${col(brand, k)}), 0)` : '0')
    /** AVG of an already-numeric column, or 0 when absent. */
    const numAvgOr0 = (k: InsuranceColumnKey) => (hasCol(brand, k) ? `COALESCE(AVG(${col(brand, k)}), 0)` : '0')
    /** COUNT of rows matching an equality, or 0 when the column (or the literal) does not exist. */
    const countEq = (k: InsuranceColumnKey, literal: string | null) =>
      hasCol(brand, k) && literal !== null
        ? `COUNT(CASE WHEN ${col(brand, k)} = '${esc(literal)}' THEN 1 END)::int`
        : '0'
    /** COUNT of rows where the column is present and non-empty, or 0 when the column is absent. */
    const countNonEmpty = (k: InsuranceColumnKey) =>
      hasCol(brand, k)
        ? `COUNT(CASE WHEN ${col(brand, k)} IS NOT NULL AND ${col(brand, k)} != '' THEN 1 END)::int`
        : '0'
    /** A query this brand cannot answer resolves to [] rather than running against a missing column. */
    type Rows = Record<string, unknown>[]
    const skipIf = (able: boolean, run: () => Promise<unknown>): Promise<Rows> =>
      able ? (run() as Promise<Rows>) : Promise.resolve([] as Rows)

    // Build WHERE clauses. Params the brand has no column for are IGNORED, not thrown — a stale
    // bookmark carrying ?status64vb=VERIFIED must not 500 the KIA tab.
    const whereConditions: string[] = ['1=1']
    const issueDate = C('policyIssueDate')

    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const year = searchParams.get('year')

    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) whereConditions.push(`${issueDate} >= '${startDate}'`)
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) whereConditions.push(`${issueDate} <= '${endDate}'`)
    if (year && year !== 'all' && /^\d{4}$/.test(year)) {
      whereConditions.push(`date_part('year', ${issueDate}) = ${parseInt(year, 10)}`)
    }

    const supported = new Set(supportedFilterParams(brand))
    for (const [param, key] of Object.entries(FILTER_PARAM_COLUMNS) as [string, InsuranceColumnKey][]) {
      if (!supported.has(param)) continue
      const value = searchParams.get(param)
      if (!value || value === 'all') continue
      whereConditions.push(`${C(key)} = '${esc(value)}'`)
    }

    const whereClause = whereConditions.join(' AND ')

    // Parallel execution of analytical queries
    const [
      kpisRes,
      monthlyTrendRes,
      companyRes,
      policyTypeRes,
      paymentModeRes,
      financerRes,
      executiveRes,
      modelRes,
      dealerRes,
      subUserRes,
      fuelRes,
      addonRes,
      policyTypeDeepRes,
      policyTypeTrendRes,
      ncbResetRes,
    ] = await Promise.all([
      // 1. Executive KPIs
      db.execute(sql.raw(`
        SELECT 
          COUNT(*)::int as total_policies,
          MIN(${issueDate}) as min_date,
          MAX(${issueDate}) as max_date,
          ${sumOr0('grossPremium')} as gross_premium,
          ${sumOr0('netPremium')} as net_premium,
          ${sumOr0('netOdPremiumA')} as net_od_premium,
          ${sumOr0('thirdPartyLiability')} as tp_liability,
          ${sumOr0('addOnPremium')} as addon_premium,
          ${numSumOr0('serviceTax')} as service_tax,
          ${numSumOr0('totalIdv')} as total_idv,
          ${countEq('policyType', PT_RENEWAL)} as renewal_count,
          ${countEq('policyType', PT_NEW)} as new_count,
          ${countEq('policyType', PT_ROLLOVER)} as rollover_count,
          ${countEq('column64vbStatus', 'VERIFIED')} as verified_64vb_count,
          ${countEq('column64vbStatus', 'NOT VERIFIED')} as not_verified_64vb_count
        FROM ${tableName}
        WHERE ${whereClause}
      `)),

      // 2. Monthly Trend (Full Mon YYYY chronological)
      db.execute(sql.raw(`
        SELECT 
          to_char(${issueDate}, 'YYYY-MM') as month_key,
          to_char(${issueDate}, 'Mon YYYY') as month_label,
          COUNT(*)::int as policies,
          ${sumOr0('grossPremium')} as gross_premium,
          ${sumOr0('netPremium')} as net_premium
        FROM ${tableName}
        WHERE ${whereClause} AND ${issueDate} IS NOT NULL
        GROUP BY month_key, month_label
        ORDER BY month_key ASC
      `)),

      // 3. Insurance Company Breakdown
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('insuranceCompany')}, 'Unspecified') as company,
          COUNT(*)::int as policies,
          ${sumOr0('grossPremium')} as gross_premium,
          ${sumOr0('netPremium')} as net_premium,
          ${countEq('policyType', PT_RENEWAL)} as renewals
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY company
        ORDER BY gross_premium DESC
      `)),

      // 4. Policy Type Breakdown
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('policyType')}, 'Unspecified') as type,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY type
        ORDER BY count DESC
      `)),

      // 5. Payment Mode Breakdown
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('paymentMode')}, 'Unspecified') as mode,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY mode
        ORDER BY count DESC
      `)),

      // 6. Financer Breakdown (Top 10)
      skipIf(
        hasCol(brand, 'financerName'),
        () => db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('financerName')}, 'Self / Direct') as financer,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY financer
        ORDER BY count DESC
        LIMIT 10
      `)),
      ),

      // 7. Executive Performance
      skipIf(
        hasCol(brand, 'rmName') || hasCol(brand, 'dpName'),
        () => db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('rmName')}, ${C('dpName')}, 'Unassigned') as executive,
          COUNT(*)::int as policies,
          ${sumOr0('grossPremium')} as gross_premium,
          ${countEq('policyType', PT_RENEWAL)} as renewals
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY executive
        ORDER BY gross_premium DESC
        LIMIT 15
      `)),
      ),

      // 8. Vehicle Model Breakdown
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('modelName')}, 'Unspecified') as model,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium,
          ${numAvgOr0('totalIdv')} as avg_idv
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY model
        ORDER BY count DESC
        LIMIT 15
      `)),

      // 9. Dealer-wise Analytics (Dealer Code)
      skipIf(
        brand.capabilities.hasMultiDealer,
        () => db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('dealerCode')}, 'Unknown') as ${C('dealerCode')},
          COALESCE(${hasCol(brand, 'mispName') ? `MAX(${C('mispName')}), ` : ''}${C('dealerCode')}, 'Dealer') as dealer_name,
          COUNT(*)::int as total_policies,
          ${sumOr0('grossPremium')} as gross_premium,
          ${sumOr0('netPremium')} as net_premium,
          ${countEq('policyType', PT_RENEWAL)} as renewals,
          ${countEq('policyType', PT_NEW)} as new_policies,
          ${countEq('column64vbStatus', 'VERIFIED')} as verified_64vb
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY ${C('dealerCode')}
        ORDER BY gross_premium DESC
      `)),
      ),

      // 10. Sub-User Branch Breakdown
      skipIf(
        hasCol(brand, 'subUser'),
        () => db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('subUser')}, 'Unassigned') as ${C('subUser')},
          COUNT(*)::int as total_policies,
          ${sumOr0('grossPremium')} as gross_premium,
          ${countEq('policyType', PT_RENEWAL)} as renewals
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY ${C('subUser')}
        ORDER BY gross_premium DESC
      `)),
      ),

      // 11. Fuel Type Breakdown
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('fuelType')}, 'Unspecified') as fuel,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY fuel
        ORDER BY count DESC
      `)),

      // 12. Add-on Coverage Opt-ins
      skipIf(
        hasCol(brand, 'addonOpted'),
        () => db.execute(sql.raw(`
        SELECT 
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%ZD%' THEN 1 END)::int as zd,
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%CM%' THEN 1 END)::int as cm,
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%EP%' THEN 1 END)::int as ep,
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%RTI%' THEN 1 END)::int as rti,
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%KP%' THEN 1 END)::int as kp,
          COUNT(CASE WHEN ${C('addonOpted')} LIKE '%PB%' THEN 1 END)::int as pb
        FROM ${tableName}
        WHERE ${whereClause}
      `)),
      ),

      // 13. Deep Policy Type Analytics (per type: full breakdown)
      db.execute(sql.raw(`
        SELECT 
          COALESCE(${C('policyType')}, 'Unspecified') as type,
          COUNT(*)::int as total_count,
          ${sumOr0('grossPremium')} as gross_premium,
          ${sumOr0('netPremium')} as net_premium,
          ${sumOr0('netOdPremiumA')} as net_od_premium,
          ${sumOr0('thirdPartyLiability')} as tp_liability,
          ${sumOr0('addOnPremium')} as addon_premium,
          ${premiumAvg(brand, 'grossPremium')} as avg_gross_premium,
          ${numAvgOr0('totalIdv')} as avg_idv,
          ${countEq('column64vbStatus', 'VERIFIED')} as verified_64vb,
          ${countEq('column64vbStatus', 'NOT VERIFIED')} as not_verified_64vb,
          ${countNonEmpty('addonOpted')} as addon_opted_count
        FROM ${tableName}
        WHERE ${whereClause}
        GROUP BY type
        ORDER BY total_count DESC
      `)),

      // 14. Policy Type Monthly/Quarterly Trend (for stacked area chart)
      db.execute(sql.raw(`
        SELECT 
          to_char(${issueDate}, 'YYYY-MM') as month_key,
          to_char(${issueDate}, 'Mon YY') as month_label,
          COALESCE(${C('policyType')}, 'Unspecified') as type,
          COUNT(*)::int as count,
          ${sumOr0('grossPremium')} as gross_premium
        FROM ${tableName}
        WHERE ${whereClause} AND ${issueDate} IS NOT NULL
        GROUP BY month_key, month_label, type
        ORDER BY month_key ASC
      `)),

      // 15. Claim incidence, via NCB reset.
      //
      // There is NO insurance claims data anywhere in this database — the *_warranty_claim_* tables
      // are vehicle warranty, a different thing entirely, and the insurer holds the real claims
      // ledger. But No Claim Bonus is reset to zero when a customer claims, and
      // current_ncb_percentage is 100% populated on every own-damage row. So a vehicle whose NCB
      // FELL between two consecutive own-damage policies almost certainly claimed in between.
      //
      // Two exclusions make it honest:
      //   - own-damage rows only (od_tenure <> '0'); a third-party top-up carries no NCB
      //   - renewals where cover had lapsed more than 90 days are dropped, because a long break
      //     kills the NCB by itself and would otherwise be counted as a claim
      //
      // The LAG runs over the vehicle's FULL history and the filter is applied afterwards. Putting
      // the filter inside the window instead looks correct and is not: with year=2026 selected, the
      // previous policy falls outside the window, every prev_ncb is NULL, and the card reports
      // "0 of 0" — measured. The filter chooses which renewals to COUNT, never what to compare against.
      skipIf(
        hasCol(brand, 'currentNcbPercentage'),
        () => db.execute(sql.raw(`
        WITH scope AS (
          SELECT id FROM ${tableName} WHERE ${whereClause}
        ),
        ev AS (
          SELECT t.id, t.${C('policyStartDate')}, t.${C('odExpiryDate')},
            NULLIF(regexp_replace(COALESCE(t.${C('currentNcbPercentage')},''), '[^0-9.]', '', 'g'),'')::numeric AS ncb,
            LAG(NULLIF(regexp_replace(COALESCE(t.${C('currentNcbPercentage')},''), '[^0-9.]', '', 'g'),'')::numeric) OVER w AS prev_ncb,
            LAG(t.${C('odExpiryDate')}) OVER w AS prev_exp
          FROM ${tableName} t
          WHERE COALESCE(NULLIF(btrim(t.${C('odTenure')}),''),'0') <> '0'
          WINDOW w AS (PARTITION BY UPPER(TRIM(t.${C('chassisNo')})) ORDER BY t.${C('policyStartDate')}, t.id)
        )
        SELECT
          COUNT(*) FILTER (WHERE ev.prev_ncb IS NOT NULL AND ev.ncb IS NOT NULL
            AND (ev.prev_exp IS NULL OR ev.${C('policyStartDate')} <= ev.prev_exp + 90))::int AS comparable_renewals,
          COUNT(*) FILTER (WHERE ev.prev_ncb IS NOT NULL AND ev.ncb IS NOT NULL AND ev.ncb < ev.prev_ncb
            AND (ev.prev_exp IS NULL OR ev.${C('policyStartDate')} <= ev.prev_exp + 90))::int AS ncb_reset_count
        FROM ev JOIN scope s ON s.id = ev.id
      `)),
      ),
    ])

    const kpiData = kpisRes[0] || {}
    const totalPolicies = safeNum(kpiData.total_policies)
    const grossPremium = safeNum(kpiData.gross_premium)
    const netPremium = safeNum(kpiData.net_premium)
    const renewalCount = safeNum(kpiData.renewal_count)
    const newCount = safeNum(kpiData.new_count)
    const rolloverCount = safeNum(kpiData.rollover_count)
    const verified64vb = safeNum(kpiData.verified_64vb_count)
    const notVerified64vb = safeNum(kpiData.not_verified_64vb_count)

    const renewalRatePct = totalPolicies > 0 ? (renewalCount / totalPolicies) * 100 : 0
    const verifiedRatePct = totalPolicies > 0 ? (verified64vb / totalPolicies) * 100 : 0
    const avgPremium = totalPolicies > 0 ? grossPremium / totalPolicies : 0

    const ncbData = ncbResetRes[0] || {}
    const comparableRenewals = safeNum(ncbData.comparable_renewals)
    const ncbResetCount = safeNum(ncbData.ncb_reset_count)
    const claimIncidencePct = comparableRenewals > 0 ? (ncbResetCount / comparableRenewals) * 100 : 0

    const addonsData = addonRes[0] || {}

    return NextResponse.json({
      type: brandId,
      brand: brandId,
      // The client keys "hide this card / tab / dropdown" off these, so a brand never renders a
      // metric as 0 when the truth is that its feed has no such column.
      capabilities: brand.capabilities,
      gapDisclosure: brand.gapDisclosure,
      summary: {
        kpis: {
          totalPolicies,
          grossPremium,
          netPremium,
          netOdPremium: safeNum(kpiData.net_od_premium),
          tpLiability: safeNum(kpiData.tp_liability),
          addonPremium: safeNum(kpiData.addon_premium),
          serviceTax: safeNum(kpiData.service_tax),
          totalIdv: safeNum(kpiData.total_idv),
          renewalCount,
          newCount,
          rolloverCount,
          renewalRatePct,
          verified64vb,
          notVerified64vb,
          verifiedRatePct,
          avgPremium,
          claimIncidencePct,
          ncbResetCount,
          comparableRenewals,
        },
        dateRange: {
          minDate: kpiData.min_date,
          maxDate: kpiData.max_date,
        },
        monthlyTrend: monthlyTrendRes.map((r: any) => ({
          monthKey: r.month_key,
          monthLabel: r.month_label,
          policies: safeNum(r.policies),
          grossPremium: safeNum(r.gross_premium),
          netPremium: safeNum(r.net_premium),
        })),
        companyBreakdown: companyRes.map((r: any) => ({
          company: r.company,
          policies: safeNum(r.policies),
          grossPremium: safeNum(r.gross_premium),
          netPremium: safeNum(r.net_premium),
          renewals: safeNum(r.renewals),
          sharePct: grossPremium > 0 ? (safeNum(r.gross_premium) / grossPremium) * 100 : 0,
        })),
        policyTypes: policyTypeRes.map((r: any) => ({
          type: r.type,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
          sharePct: totalPolicies > 0 ? (safeNum(r.count) / totalPolicies) * 100 : 0,
        })),
        paymentModes: paymentModeRes.map((r: any) => ({
          mode: r.mode,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
          sharePct: totalPolicies > 0 ? (safeNum(r.count) / totalPolicies) * 100 : 0,
        })),
        financers: financerRes.map((r: any) => ({
          financer: r.financer,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
        })),
        executives: executiveRes.map((r: any) => ({
          executive: r.executive,
          policies: safeNum(r.policies),
          grossPremium: safeNum(r.gross_premium),
          renewals: safeNum(r.renewals),
          renewalPct: safeNum(r.policies) > 0 ? (safeNum(r.renewals) / safeNum(r.policies)) * 100 : 0,
        })),
        models: modelRes.map((r: any) => ({
          model: r.model,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
          avgIdv: safeNum(r.avg_idv),
          sharePct: totalPolicies > 0 ? (safeNum(r.count) / totalPolicies) * 100 : 0,
        })),
        dealers: dealerRes.map((r: any) => ({
          dealerCode: r.dealer_code,
          dealerName: r.dealer_name,
          totalPolicies: safeNum(r.total_policies),
          grossPremium: safeNum(r.gross_premium),
          netPremium: safeNum(r.net_premium),
          renewals: safeNum(r.renewals),
          newPolicies: safeNum(r.new_policies),
          verified64vb: safeNum(r.verified_64vb),
        })),
        subUsers: subUserRes.map((r: any) => ({
          subUser: r.sub_user,
          totalPolicies: safeNum(r.total_policies),
          grossPremium: safeNum(r.gross_premium),
          renewals: safeNum(r.renewals),
        })),
        fuelTypes: fuelRes.map((r: any) => ({
          fuel: r.fuel,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
          sharePct: totalPolicies > 0 ? (safeNum(r.count) / totalPolicies) * 100 : 0,
        })),
        addons: [
          { code: 'ZD', name: 'Zero Dep (ZD)', count: safeNum(addonsData.zd) },
          { code: 'KP', name: 'Key Protect (KP)', count: safeNum(addonsData.kp) },
          { code: 'PB', name: 'Personal Belonging (PB)', count: safeNum(addonsData.pb) },
          { code: 'CM', name: 'Consumables (CM)', count: safeNum(addonsData.cm) },
          { code: 'EP', name: 'Engine Protect (EP)', count: safeNum(addonsData.ep) },
          { code: 'RTI', name: 'Return to Invoice (RTI)', count: safeNum(addonsData.rti) },
        ],
        policyTypeDeep: policyTypeDeepRes.map((r: any) => ({
          type: r.type,
          totalCount: safeNum(r.total_count),
          grossPremium: safeNum(r.gross_premium),
          netPremium: safeNum(r.net_premium),
          netOdPremium: safeNum(r.net_od_premium),
          tpLiability: safeNum(r.tp_liability),
          addonPremium: safeNum(r.addon_premium),
          avgGrossPremium: safeNum(r.avg_gross_premium),
          avgIdv: safeNum(r.avg_idv),
          verified64vb: safeNum(r.verified_64vb),
          notVerified64vb: safeNum(r.not_verified_64vb),
          addonOptedCount: safeNum(r.addon_opted_count),
          topPaymentMode: r.top_payment_mode || 'N/A',
          topFuelType: r.top_fuel_type || 'N/A',
          topInsurer: r.top_insurer || 'N/A',
          sharePct: totalPolicies > 0 ? (safeNum(r.total_count) / totalPolicies) * 100 : 0,
          premiumSharePct: grossPremium > 0 ? (safeNum(r.gross_premium) / grossPremium) * 100 : 0,
          verifiedPct: safeNum(r.total_count) > 0 ? (safeNum(r.verified_64vb) / safeNum(r.total_count)) * 100 : 0,
          addonAdoptionPct: safeNum(r.total_count) > 0 ? (safeNum(r.addon_opted_count) / safeNum(r.total_count)) * 100 : 0,
        })),
        policyTypeTrend: policyTypeTrendRes.map((r: any) => ({
          monthKey: r.month_key,
          monthLabel: r.month_label,
          type: r.type,
          count: safeNum(r.count),
          grossPremium: safeNum(r.gross_premium),
        })),
      },
    })
  } catch (error: any) {
    console.error('[insurance:summary:error]', error)
    return NextResponse.json({ error: error.message || 'Failed to compute insurance summary' }, { status: 500 })
  }
}
