import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import {
  CHASSIS_PATTERN,
  FILTER_PARAM_COLUMNS,
  HISTORY_COLUMN_KEYS,
  INSURANCE_BRANDS,
  col,
  esc,
  historyTables,
  resolveBrand,
  resolveSortColumn,
  searchableColumns,
  selectList,
  supportedFilterParams,
  type InsuranceColumnKey,
  insuranceSource,} from '@/lib/insurance/brands'

export const dynamic = 'force-dynamic'
// Vercel kills a Node function at ~10s by default; a cold pooler connection alone costs ~1.8s.
export const maxDuration = 30

/** Columns the register table and the policy inspector read, in display order. */
const ROW_KEYS: InsuranceColumnKey[] = [
  'id', 'policyNo', 'proposalNo', 'customerName', 'insuranceCompany', 'policyType',
  'modelName', 'variantName', 'vehRegistNo', 'chassisNo', 'engineNo', 'grossPremium', 'netPremium',
  'netOdPremiumA', 'thirdPartyLiability', 'addOnPremium', 'addonOpted', 'serviceTax',
  'totalIdv', 'policyIssueDate', 'policyStartDate', 'odExpiryDate', 'column64vbStatus',
  'paymentMode', 'rmName', 'dpName', 'dealerCode', 'subUser',
  'odTenure', 'tpTenure', 'currentNcbPercentage', 'mfgYear', 'fuelType',
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

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '25', 10)))
    const search = (searchParams.get('search') || '').trim()
    const format = searchParams.get('format')
    const sortField = searchParams.get('sort') || 'policy_issue_date'
    const sortDir = (searchParams.get('direction') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    // Resolved through the brand map: the previous default was the literal 'policy_issue_date',
    // which does not exist in kia_insurance — the very first KIA request would 500 with 42703
    // before any filter was touched.
    const safeSortField = resolveSortColumn(brand, sortField)

    /**
     * Per-vehicle history, for the Customer Retention drill-down.
     *
     * Deliberately NOT routed through `search`: that expands to an unanchored ILIKE across nine
     * columns and would match a VIN against unrelated free-text fields. This is strict equality on
     * a validated 17-character VIN, or nothing.
     *
     * Presence of chassisNo also means "show this vehicle's whole life": the page's date/dealer/
     * insurer filters are skipped, because truncating a vehicle's history to the active date range
     * is precisely the bug the vehicle view exists to fix.
     */
    const chassisRaw = (searchParams.get('chassisNo') || '').trim().toUpperCase()
    const chassisNo = /^[A-HJ-NPR-Z0-9]{17}$/.test(chassisRaw) ? chassisRaw : ''
    // 492 chassis are insured at both dealerships; without the union the modal would show fewer
    // policies than the row it was opened from claims.
    // Only brands that actually share vehicles with a sibling table. KIA has zero VIN overlap with
    // Hyundai, so for KIA the union is not merely wrong, it is empty.
    const includeOther =
      Boolean(chassisNo) &&
      searchParams.get('includeOther') === '1' &&
      brand.capabilities.hasCrossDealerHistory
    // Every arm must have identical arity, so absent columns are filled with NULL rather than
    // skipped. Explicit column list, not SELECT * — the tables have 100 / 85 / 50 columns.
    const fromClause = includeOther
      ? `(${historyTables(brand)
          .map(
            (t) =>
              `SELECT ${selectList(t.id, HISTORY_COLUMN_KEYS, { fillAbsentWithNull: true })}, '${t.id}' AS source ` +
              `FROM ${t.table}`,
          )
          .join(' UNION ALL ')}) u`
      : tableName

    // Build WHERE clauses
    const whereConditions: string[] = ['1=1']
    if (chassisNo) whereConditions.push(`UPPER(TRIM(${col(brand, 'chassisNo')})) = '${chassisNo}'`)

    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Dates first — they key off the brand's issue-date column, not a literal.
    // All page-level filters are skipped for a vehicle drill-down: applying them would truncate the
    // history the user opened the row to see.
    const issueDate = col(brand, 'policyIssueDate')
    if (startDate && !chassisNo && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      whereConditions.push(`${issueDate} >= '${startDate}'`)
    }
    if (endDate && !chassisNo && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      whereConditions.push(`${issueDate} <= '${endDate}'`)
    }
    const year = searchParams.get('year')
    if (year && !chassisNo && year !== 'all' && /^\d{4}$/.test(year)) {
      whereConditions.push(`date_part('year', ${issueDate}) = ${parseInt(year, 10)}`)
    }

    // Equality filters, driven by what this brand actually has. A param the brand does not support
    // is IGNORED silently rather than throwing — a stale bookmark must not 500.
    const supported = new Set(supportedFilterParams(brand))
    for (const [param, key] of Object.entries(FILTER_PARAM_COLUMNS) as [string, InsuranceColumnKey][]) {
      if (!supported.has(param)) continue
      const value = searchParams.get(param)
      if (!value || chassisNo || value === 'all') continue
      if (param === 'financer' && value === 'Self / Direct') {
        whereConditions.push(`(${col(brand, key)} IS NULL OR ${col(brand, key)} = '')`)
      } else if (param === 'addonOpted') {
        whereConditions.push(`${col(brand, key)} LIKE '%${esc(value)}%'`)
      } else if (param === 'policyType') {
        whereConditions.push(`UPPER(${col(brand, key)}) = '${esc(value.toUpperCase())}'`)
      } else {
        whereConditions.push(`${col(brand, key)} = '${esc(value)}'`)
      }
    }

    // Skipped for a vehicle drill-down: the chassis equality above is already the whole selection,
    // and this clause touches columns (addon_opted) that the cross-dealer union does not project.
    if (search && !chassisNo) {
      const sanitized = esc(search)
      const cols = searchableColumns(brand)
      if (cols.length) {
        whereConditions.push(`(${cols.map((c) => `${c} ILIKE '%${sanitized}%'`).join(' OR ')})`)
      }
    }

    const whereClause = whereConditions.join(' AND ')

    if (format === 'csv') {
      // Absent columns are filled with NULL so the header row and the value row stay aligned —
      // a KIA export has no 64VB / RM / sub-user, and a skipped column would shift every field after it.
      const csvKeys = ['id','policyNo','proposalNo','customerName','insuranceCompany','policyType',
      'modelName','variantName','vehRegistNo','chassisNo','engineNo','grossPremium','netPremium',
      'totalIdv','policyIssueDate','policyStartDate','odExpiryDate','column64vbStatus',
      'paymentMode','rmName','dealerCode','subUser'] as InsuranceColumnKey[]
      const rows = await db.execute(sql.raw(`
        SELECT ${selectList(brand, csvKeys, { fillAbsentWithNull: true })}
        FROM ${tableName}
        WHERE ${whereClause}
        ORDER BY ${safeSortField} ${sortDir} NULLS LAST
        LIMIT 5000
      `))

      const headers = [
        'ID', 'Policy No', 'Proposal No', 'Customer Name', 'Insurance Company', 'Policy Type',
        'Model Name', 'Variant', 'Veh Reg No', 'Chassis No', 'Gross Premium', 'Net Premium',
        'Total IDV', 'Issue Date', 'Start Date', 'Expiry Date', '64VB Status', 'Payment Mode',
        'RM/Executive', 'Dealer Code', 'Sub User'
      ]

      const csvLines = [headers.join(',')]
      rows.forEach((r: any) => {
        const line = [
          r.id, r.policy_no, r.proposal_no, r.customer_name, r.insurance_company, r.policy_type,
          r.model_name, r.variant_name, r.veh_regist_no, r.chassis_no, r.gross_premium, r.net_premium,
          r.total_idv, r.policy_issue_date, r.policy_start_date, r.od_expiry_date, r.column_64vb_status,
          r.payment_mode, r.rm_name, r.dealer_code, r.sub_user
        ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
        csvLines.push(line)
      })

      return new Response(csvLines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${brandId}-insurance-policies.csv"`,
        },
      })
    }

    const offset = (page - 1) * pageSize

    /*
     * ── Which year of cover is this? ─────────────────────────────────────────────────────────────
     *
     * The register showed the feed's own policy_type, so every renewal read the same whether it was
     * the customer's second year or their fifth. These two columns turn it into a position:
     * `policy_seq` is where this policy sits in the vehicle's history, and `first_policy_type` says
     * whether we hold the policy that STARTED the relationship. lib/insurance/policy-year.ts turns
     * the pair into Y1 / Y2+ / Rollover.
     *
     * ⚠️ THE WINDOW RUNS OVER THE WHOLE TABLE, BEFORE THE WHERE — that is the entire reason for the
     * CTE. Numbering the FILTERED rows would make the year depend on the date range on screen: pick
     * "this month" and every policy in it becomes Y1. The sequence is a property of the vehicle, not
     * of the current view.
     *
     * ⚠️ Partitioned on the chassis, falling back to the row id when it is blank. Without the
     * fallback every chassis-less policy would share one partition and be numbered 1..N as though
     * they were one car's history.
     *
     * Downstream of the cross-dealer UNION the columns are already canonical, so the expressions
     * differ per path — the same asymmetry the SELECT below already handles.
     */
    const seqChassis = includeOther ? 'chassis_no' : col(brand, 'chassisNo')
    const seqIssue = includeOther ? 'policy_issue_date' : col(brand, 'policyIssueDate')
    const seqType = includeOther ? 'policy_type' : col(brand, 'policyType')
    const seqTie = includeOther ? 'policy_no' : col(brand, 'policyNo')
    // Cover start, for the chain's per-year period labels. Not every brand carries one, so the
    // aggregate coalesces to the issue date rather than assuming it exists.
    const seqStart = includeOther ? 'policy_start_date' : col(brand, 'policyStartDate')
    const seqMfg = includeOther ? 'mfg_year' : col(brand, 'mfgYear')
    const seqPartition = `COALESCE(NULLIF(UPPER(TRIM(${seqChassis})), ''), 'row-' || ${col(brand, 'id')}::text)`
    const seqOrder = `${seqIssue} ASC NULLS LAST, ${seqTie} ASC NULLS LAST`

    /*
     * ⚠️ NO ALIAS OF OUR OWN. `insuranceSource(brand)` does not return a table name — it returns a
     * DISTINCT ON de-duplication subquery that already carries its alias, e.g.
     *   (SELECT DISTINCT ON (policy_no) * FROM hyundai_... ORDER BY ...) AS hyundai_...
     * Adding a second alias is a syntax error, and it only shows on the brands whose source is that
     * subquery — KIA reads a bare table and would have looked fine while Hyundai and Platinum 500'd.
     */
    const sequencedFrom = `(
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY ${seqPartition} ORDER BY ${seqOrder}) AS policy_seq,
             /*
              * The vehicle's WHOLE policy history, oldest first — not just this row's own type.
              * The register renders the entire chain on every row (Y1 · Y2 · Rollover · Y3), so it
              * needs the full ordered list plus this row's index into it.
              */
             ARRAY_AGG(UPPER(TRIM(COALESCE(${seqType}, '')))) OVER (
               PARTITION BY ${seqPartition} ORDER BY ${seqOrder}
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
             ) AS policy_chain,
             /*
              * The COVER PERIOD of each policy in the chain, so a chip can say which year it means.
              * "Y4" beside a 2026 issue date reads as a contradiction until you can see that Y4 is
              * the 2026-27 cover year — the label counts the customer's years with us, not the
              * length of any one policy (these are all 1-year policies).
              */
             /*
              * ⚠️ ::text on each element. The postgres driver parses text[] into a JS array but
              * hands back a date[] as the raw Postgres literal "{2023-10-20,2024-10-20}" — a
              * STRING — so the chain silently lost every period and every chip read "null policy
              * year". Casting at source keeps it an array the client can index.
              */
             ARRAY_AGG(COALESCE(${seqStart}, ${seqIssue})::text) OVER (
               PARTITION BY ${seqPartition} ORDER BY ${seqOrder}
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
             ) AS policy_chain_starts,
             /*
              * The vehicle's manufacture year, so the chain can be numbered by the CAR'S AGE rather
              * than by how many policies we happen to hold.
              *
              * ⚠️ This is the whole point. Counting rows made a 2021 Santro's 2026-27 policy read
              * "Y4" because we only hold four of its policies — but 2026 is that car's SIXTH year.
              * The number has to mean the vehicle's year, or it contradicts the issue date sitting
              * next to it. Populated on 100% of Hyundai and Platinum rows.
              */
             MIN(NULLIF(regexp_replace(${seqMfg}::text, '[^0-9]', '', 'g'), '')::int) OVER (
               PARTITION BY ${seqPartition}
             ) AS policy_mfg_year
      FROM ${fromClause}
    ) seqd`

    const [countRes, rowsRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT COUNT(*)::int as total
        FROM ${fromClause}
        WHERE ${whereClause}
      `)),
      db.execute(sql.raw(`
        SELECT ${
          includeOther
            // Downstream of the union the columns are ALREADY canonical, so select them by their
            // canonical names rather than re-resolving through the brand map.
            ? selectList('hyundai', HISTORY_COLUMN_KEYS, { fillAbsentWithNull: true }) + ", source"
            : selectList(brand, ROW_KEYS, { fillAbsentWithNull: true })
        }
        , policy_seq, policy_chain, policy_chain_starts, policy_mfg_year
        FROM ${sequencedFrom}
        WHERE ${whereClause}
        ORDER BY ${safeSortField} ${sortDir} NULLS LAST
        LIMIT ${pageSize} OFFSET ${offset}
      `)),
    ])

    const totalCount = Number(countRes[0]?.total || 0)
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

    return NextResponse.json({
      page,
      pageSize,
      totalCount,
      totalPages,
      policies: rowsRes,
      rows: rowsRes,
    })
  } catch (error: any) {
    console.error('[insurance:policies:error]', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch policy register' }, { status: 500 })
  }
}
