/**
 * Deep Hyundai analytics coverage report (excludes warranty tables).
 * Usage: node scripts/analyze-hyundai-data-coverage.js [--json]
 */
require('dotenv').config({ quiet: true })
const fs = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const HYUNDAI_BRANCH_DEALERS = {
  jammu: ['N5216', 'N6846', 'N6847'],
  udhampur: ['N5217', 'N6848', 'N6849'],
}

const TABLE_SPECS = [
  {
    table: 'hyundai_ro_billing_report',
    label: 'RO Billing',
    dealerExprs: ['dealer_code', 'main_dealer_code', 'source_dealer_code'],
    dateExprs: ['bill_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_repair_order_list',
    label: 'Open RO / Repair Orders',
    dealerExprs: ['dealer', 'dealer_code', 'source_dealer_code', 'main_dealer', 'dlr_no'],
    dateExprs: ['r_o_date', 'ro_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_call_center_complaints',
    label: 'Call Center Complaints',
    dealerExprs: ['source_dealer_code', 'dealer_code', 'dealer'],
    dateExprs: ['complaint_date', 'resolving_date', 'close_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_ew_report',
    label: 'Extended Warranty',
    dealerExprs: ['dlr_no', 'dealer_code', 'source_dealer_code'],
    dateExprs: ['reg_date', 'ew_reg_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_adv_wise_lubricants_vas',
    label: 'Advisor-wise Lubricants VAS',
    dealerExprs: ['source_dealer_code', 'dealer_code'],
    dateExprs: ['gst_invoice_date', 'invoice_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_service_appointment',
    label: 'Service Appointments',
    dealerExprs: ['dealer_code', 'source_dealer_code', 'dealer'],
    dateExprs: ['appointment_date', 'a_t_date_time', 'web_appointment_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_demo_car_list',
    label: 'Demo Cars',
    dealerExprs: ['dealer_code', 'main_dealer_code', 'source_dealer_code'],
    dateExprs: ['invoice_date', 'retail_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_customer_complaint_list',
    label: 'Customer Complaints',
    dealerExprs: ['source_dealer_code', 'dealer_code'],
    dateExprs: ['complaint_date', 'resolving_date'],
    uploadExpr: 'uploaded_at',
  },
  {
    table: 'hyundai_operation_wise_analysis_report',
    label: 'Operation-wise Analysis (dropped from Supabase)',
    dealerExprs: ['source_dealer_code', 'dealer_code'],
    dateExprs: ['report_period_start', 'report_month'],
    uploadExpr: 'uploaded_at',
    optional: true,
  },
  {
    table: 'hyundai_psf_yearly',
    label: 'PSF Yearly (dropped from Supabase)',
    dealerExprs: ['source_dealer_code', 'dealer_code'],
    dateExprs: ['report_year', 'year'],
    uploadExpr: 'uploaded_at',
    optional: true,
  },
]

const DROPPED_BACKUP_DIR = path.join(
  process.cwd(),
  'backups',
  'analytics-tables',
  '2026-06-15',
)

async function tableExists(db, tableName) {
  const [row] = await db`
    SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists
  `
  return Boolean(row?.exists)
}

async function getColumns(db, tableName) {
  const rows = await db`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `
  return new Set(rows.map((row) => row.column_name))
}

function pickExpr(columns, candidates, fallback = null) {
  for (const name of candidates) {
    if (columns.has(name)) return name
  }
  return fallback
}

function sqlIdent(name) {
  return `"${name}"`
}

async function analyzeTable(db, spec) {
  const exists = await spec.optional ? await tableExists(db, spec.table) : await tableExists(db, spec.table)
  if (!exists) {
    const backupPath = path.join(DROPPED_BACKUP_DIR, `${spec.table}.json`)
    const backup = fs.existsSync(backupPath)
      ? JSON.parse(fs.readFileSync(backupPath, 'utf8'))
      : null
    return {
      table: spec.table,
      label: spec.label,
      exists: false,
      status: 'missing_from_supabase',
      backupAvailable: Boolean(backup),
      backupRows: backup?.rowCount ?? null,
      backupExportedAt: backup?.exportedAt ?? null,
    }
  }

  const columns = await getColumns(db, spec.table)
  const dealerExpr = pickExpr(columns, spec.dealerExprs)
  const dateExpr = pickExpr(columns, spec.dateExprs)
  const uploadExpr = columns.has(spec.uploadExpr) ? spec.uploadExpr : null

  const [sizeRow] = await db.unsafe(`
    SELECT
      COUNT(*)::bigint AS row_count,
      pg_total_relation_size('public.${spec.table}')::bigint AS total_bytes,
      ${uploadExpr ? `MIN(${sqlIdent(uploadExpr)})::text` : 'NULL::text'} AS min_uploaded_at,
      ${uploadExpr ? `MAX(${sqlIdent(uploadExpr)})::text` : 'NULL::text'} AS max_uploaded_at
    FROM public."${spec.table}"
  `)

  let dateSummary = null
  if (dateExpr) {
    const [row] = await db.unsafe(`
      SELECT
        MIN(${sqlIdent(dateExpr)})::text AS min_date,
        MAX(${sqlIdent(dateExpr)})::text AS max_date,
        COUNT(*) FILTER (WHERE ${sqlIdent(dateExpr)} IS NULL)::bigint AS null_dates
      FROM public."${spec.table}"
    `)
    dateSummary = row
  }

  let dealerSummary = null
  let dealers = []
  if (dealerExpr) {
    const [row] = await db.unsafe(`
      SELECT
        COUNT(DISTINCT NULLIF(TRIM(${sqlIdent(dealerExpr)}::text), ''))::int AS distinct_dealers,
        COUNT(*) FILTER (WHERE NULLIF(TRIM(${sqlIdent(dealerExpr)}::text), '') IS NULL)::bigint AS null_dealers
      FROM public."${spec.table}"
    `)
    dealerSummary = row

    dealers = await db.unsafe(`
      SELECT
        NULLIF(TRIM(${sqlIdent(dealerExpr)}::text), '') AS dealer_code,
        COUNT(*)::bigint AS row_count,
        ${dateExpr ? `MIN(${sqlIdent(dateExpr)})::text` : 'NULL::text'} AS min_date,
        ${dateExpr ? `MAX(${sqlIdent(dateExpr)})::text` : 'NULL::text'} AS max_date,
        ${uploadExpr ? `MAX(${sqlIdent(uploadExpr)})::text` : 'NULL::text'} AS latest_uploaded_at
      FROM public."${spec.table}"
      GROUP BY 1
      ORDER BY row_count DESC NULLS LAST, dealer_code ASC NULLS LAST
    `)
  }

  let yearly = []
  if (dateExpr) {
    yearly = await db.unsafe(`
      SELECT
        EXTRACT(YEAR FROM ${sqlIdent(dateExpr)})::int AS year,
        COUNT(*)::bigint AS row_count
      FROM public."${spec.table}"
      WHERE ${sqlIdent(dateExpr)} IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `)
  }

  return {
    table: spec.table,
    label: spec.label,
    exists: true,
    status: 'present',
    rowCount: Number(sizeRow.row_count || 0),
    sizeMb: Number(sizeRow.total_bytes || 0) / (1024 * 1024),
    dealerColumn: dealerExpr,
    dateColumn: dateExpr,
    uploadColumn: uploadExpr,
    minUploadedAt: sizeRow.min_uploaded_at,
    maxUploadedAt: sizeRow.max_uploaded_at,
    dateRange: dateSummary
      ? {
          min: dateSummary.min_date,
          max: dateSummary.max_date,
          nullDates: Number(dateSummary.null_dates || 0),
        }
      : null,
    dealers: {
      distinct: dealerSummary ? Number(dealerSummary.distinct_dealers || 0) : 0,
      nullRows: dealerSummary ? Number(dealerSummary.null_dealers || 0) : 0,
      breakdown: dealers.map((row) => ({
        dealerCode: row.dealer_code,
        rowCount: Number(row.row_count || 0),
        minDate: row.min_date,
        maxDate: row.max_date,
        latestUploadedAt: row.latest_uploaded_at,
        branch: classifyBranch(row.dealer_code),
      })),
    },
    yearlyBreakdown: yearly.map((row) => ({
      year: Number(row.year),
      rowCount: Number(row.row_count || 0),
    })),
  }
}

function classifyBranch(dealerCode) {
  if (!dealerCode) return 'unknown'
  const normalized = String(dealerCode).trim().toUpperCase()
  if (HYUNDAI_BRANCH_DEALERS.jammu.includes(normalized)) return 'jammu'
  if (HYUNDAI_BRANCH_DEALERS.udhampur.includes(normalized)) return 'udhampur'
  return 'other'
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Hyundai Analytics Data Coverage')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('Scope: all `hyundai_*` analytics tables **except warranty** (`hyundai_warranty_*`).')
  lines.push('')
  lines.push('Canonical Hyundai dealer codes in app:')
  lines.push('- Jammu: `N5216`, `N6846`, `N6847`')
  lines.push('- Udhampur: `N5217`, `N6848`, `N6849`')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`| Table | Status | Rows | Size | Business date range | Dealers |`)
  lines.push(`|-------|--------|------|------|---------------------|---------|`)

  for (const table of report.tables) {
    if (!table.exists) {
      lines.push(
        `| \`${table.table}\` | ${table.status}${table.backupAvailable ? ' (backup JSON exists)' : ''} | — | — | — | — |`,
      )
      continue
    }
    const range = table.dateRange
      ? `${table.dateRange.min ?? '—'} → ${table.dateRange.max ?? '—'}`
      : '—'
    lines.push(
      `| \`${table.table}\` | present | ${table.rowCount.toLocaleString()} | ${table.sizeMb.toFixed(2)} MB | ${range} | ${table.dealers.distinct} |`,
    )
  }

  for (const table of report.tables) {
    lines.push('')
    lines.push(`## ${table.label} (\`${table.table}\`)`)
    if (!table.exists) {
      lines.push(`- **Status:** not in Supabase`)
      if (table.backupAvailable) {
        lines.push(`- **Local backup:** ${table.backupRows?.toLocaleString?.() ?? table.backupRows} rows exported ${table.backupExportedAt}`)
      }
      continue
    }

    lines.push(`- **Rows:** ${table.rowCount.toLocaleString()}`)
    lines.push(`- **Size:** ${table.sizeMb.toFixed(2)} MB`)
    if (table.dateRange) {
      lines.push(`- **Business dates (${table.dateColumn}):** ${table.dateRange.min} → ${table.dateRange.max} (${table.dateRange.nullDates} null)`)
    }
    if (table.uploadColumn) {
      lines.push(`- **Import freshness (${table.uploadColumn}):** ${table.minUploadedAt} → ${table.maxUploadedAt}`)
    }
    if (table.yearlyBreakdown?.length) {
      lines.push('- **Rows by year:** ' + table.yearlyBreakdown.map((y) => `${y.year}: ${y.rowCount.toLocaleString()}`).join(', '))
    }
    if (table.dealers.breakdown.length) {
      lines.push('')
      lines.push('| Dealer | Branch | Rows | Date range | Latest upload |')
      lines.push('|--------|--------|------|------------|---------------|')
      for (const dealer of table.dealers.breakdown) {
        lines.push(
          `| ${dealer.dealerCode ?? '(null)'} | ${dealer.branch} | ${dealer.rowCount.toLocaleString()} | ${dealer.minDate ?? '—'} → ${dealer.maxDate ?? '—'} | ${dealer.latestUploadedAt ?? '—'} |`,
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const jsonOnly = process.argv.includes('--json')
  const url = await pickDatabaseUrl(postgres, '[hyundai-analysis]')
  const db = postgres(url, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 60,
    connection: { statement_timeout: 600_000 },
  })

  try {
    const tables = []
    for (const spec of TABLE_SPECS) {
      console.log(`[hyundai-analysis] analyzing ${spec.table}...`)
      tables.push(await analyzeTable(db, spec))
    }

    const report = {
      generatedAt: new Date().toISOString(),
      branchDealerCodes: HYUNDAI_BRANCH_DEALERS,
      excludedTables: ['hyundai_warranty_claim_list', 'hyundai_warranty_claim_ytp', 'hyundai_warranty_claim_actions', 'hyundai_warranty_claim_evidence', 'hyundai_warranty_dealer_mappings'],
      tables,
    }

    const outPath = path.join(process.cwd(), 'docs', `hyundai-data-coverage-${new Date().toISOString().slice(0, 10)}.md`)
    fs.writeFileSync(outPath, renderMarkdown(report))
    if (jsonOnly) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`[hyundai-analysis] wrote ${outPath}`)
      console.log(renderMarkdown(report))
    }
  } finally {
    await db.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('[hyundai-analysis] failed', error.message)
  process.exit(1)
})
