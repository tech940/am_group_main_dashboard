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
  'modelName', 'variantName', 'vehRegistNo', 'chassisNo', 'grossPremium', 'netPremium',
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
        FROM ${fromClause}
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
      rows: rowsRes,
    })
  } catch (error: any) {
    console.error('[insurance:policies:error]', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch policy register' }, { status: 500 })
  }
}
