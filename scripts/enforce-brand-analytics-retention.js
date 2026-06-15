/**
 * Enforce analytics row retention for Hyundai + Platinum (not KIA).
 *
 * Policy:
 * - RO billing, repair order, operation-wise (if present): keep 2021-01-01 .. today
 * - All other brand analytics tables: keep 2024-07-01 .. today (mid-2024)
 * - Excludes warranty tables (hyundai_warranty_*)
 *
 * Usage:
 *   node scripts/enforce-brand-analytics-retention.js --dry-run
 *   node scripts/enforce-brand-analytics-retention.js
 */
require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const FULL_HISTORY_START = '2021-01-01'
const RECENT_START = '2024-07-01'

const FULL_HISTORY_TABLES = new Set([
  'am_platinum_ro_billing_report',
  'am_platinum_repair_order_list',
  'am_platinum_operation_wise_analysis_report',
  'am_platinum_operation_wise_analysis_advisor_report',
  'hyundai_ro_billing_report',
  'hyundai_repair_order_list',
  'hyundai_operation_wise_analysis_report',
])

const DATE_COLUMNS = {
  am_platinum_ro_billing_report: ['bill_date', 'r_o_date', 'uploaded_at'],
  am_platinum_repair_order_list: ['r_o_date', 'ro_date', 'uploaded_at'],
  am_platinum_operation_wise_analysis_report: ['report_period_start', 'report_period_end', 'uploaded_at'],
  am_platinum_operation_wise_analysis_advisor_report: ['report_period_start', 'report_period_end', 'uploaded_at'],
  am_platinum_call_center_complaints: ['complaint_date', 'resolving_date', 'close_date', 'uploaded_at'],
  am_platinum_ew_report: ['report_date', 'reg_date', 'ew_reg_date', 'uploaded_at'],
  am_platinum_trust_package: ['reg_date', 'uploaded_at'],
  am_platinum_service_appointment: ['appointment_date', 'a_t_date_time', 'uploaded_at'],
  am_platinum_adv_wise_lubricants_vas: ['gst_invoice_date', 'invoice_date', 'uploaded_at'],
  am_platinum_psf_yearly: ['r_o_date', 'g_p_date', 'uploaded_at'],
  am_platinum_demo_car_list: ['invoice_date', 'retail_date', 'uploaded_at'],
  am_platinum_customer_complaint_list: ['complaint_date', 'resolving_date', 'uploaded_at'],
  am_platinum_rsa_report: ['report_date', 'uploaded_at'],
  hyundai_ro_billing_report: ['bill_date', 'uploaded_at'],
  hyundai_repair_order_list: ['r_o_date', 'ro_date', 'uploaded_at'],
  hyundai_operation_wise_analysis_report: ['report_period_start', 'report_month', 'uploaded_at'],
  hyundai_call_center_complaints: ['complaint_date', 'resolving_date', 'close_date', 'uploaded_at'],
  hyundai_ew_report: ['reg_date', 'ew_reg_date', 'uploaded_at'],
  hyundai_adv_wise_lubricants_vas: ['gst_invoice_date', 'invoice_date', 'uploaded_at'],
  hyundai_service_appointment: ['appointment_date', 'a_t_date_time', 'web_appointment_date', 'uploaded_at'],
  hyundai_demo_car_list: ['invoice_date', 'retail_date', 'uploaded_at'],
  hyundai_customer_complaint_list: ['complaint_date', 'resolving_date', 'uploaded_at'],
  hyundai_psf_yearly: ['r_o_date', 'g_p_date', 'uploaded_at'],
}

function parseArgs() {
  return { dryRun: process.argv.includes('--dry-run') }
}

function assertSafeTableName(tableName) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) throw new Error(`Unsafe table: ${tableName}`)
}

async function listBrandTables(db) {
  const rows = await db`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND (
        table_name LIKE 'am_platinum_%'
        OR table_name LIKE 'hyundai_%'
      )
      AND table_name NOT LIKE 'hyundai_warranty_%'
    ORDER BY table_name
  `
  return rows.map((row) => row.table_name)
}

async function getColumns(db, tableName) {
  const rows = await db`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `
  return new Set(rows.map((row) => row.column_name))
}

function buildEffectiveDateExpr(columns, candidates) {
  const parts = []
  for (const name of candidates) {
    if (!columns.has(name)) continue
    if (name === 'uploaded_at') {
      parts.push(`CASE WHEN ${quoteIdent(name)} IS NULL THEN NULL ELSE (${quoteIdent(name)} AT TIME ZONE 'UTC')::date END`)
    } else if (name === 'a_t_date_time' || name === 'web_appointment_date') {
      parts.push(`CASE WHEN NULLIF(BTRIM(${quoteIdent(name)}::text), '') IS NULL THEN NULL ELSE LEFT(${quoteIdent(name)}::text, 10)::date END`)
    } else if (name === 'report_month') {
      parts.push(`CASE WHEN NULLIF(BTRIM(${quoteIdent(name)}::text), '') IS NULL THEN NULL ELSE (BTRIM(${quoteIdent(name)}::text) || '-01')::date END`)
    } else {
      parts.push(`${quoteIdent(name)}::date`)
    }
  }
  if (parts.length === 0) return null
  return `COALESCE(${parts.join(', ')})`
}

function quoteIdent(name) {
  return `"${name}"`
}

async function analyzeTable(db, tableName) {
  assertSafeTableName(tableName)
  const columns = await getColumns(db, tableName)
  const policy = FULL_HISTORY_TABLES.has(tableName) ? 'full_history' : 'recent_only'
  const minDate = policy === 'full_history' ? FULL_HISTORY_START : RECENT_START
  const dateCandidates = DATE_COLUMNS[tableName] || ['uploaded_at']
  const effectiveDateExpr = buildEffectiveDateExpr(columns, dateCandidates)

  if (!effectiveDateExpr) {
    return {
      tableName,
      policy,
      minDate,
      skipped: true,
      reason: 'no date columns available',
    }
  }

  const [stats] = await db.unsafe(`
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (
        WHERE ${effectiveDateExpr} IS NULL
           OR ${effectiveDateExpr} < DATE '${minDate}'
           OR ${effectiveDateExpr} > CURRENT_DATE
      )::bigint AS delete_rows,
      MIN(${effectiveDateExpr})::text AS min_keep_candidate,
      MAX(${effectiveDateExpr})::text AS max_keep_candidate
    FROM public."${tableName}"
  `)

  return {
    tableName,
    policy,
    minDate,
    effectiveDateExpr,
    totalRows: Number(stats.total_rows || 0),
    deleteRows: Number(stats.delete_rows || 0),
    keepRows: Number(stats.total_rows || 0) - Number(stats.delete_rows || 0),
    minDateBefore: stats.min_keep_candidate,
    maxDateBefore: stats.max_keep_candidate,
    skipped: false,
  }
}

async function deleteOutOfRange(db, tableName, effectiveDateExpr, minDate) {
  const result = await db.unsafe(`
    DELETE FROM public."${tableName}"
    WHERE ${effectiveDateExpr} IS NULL
       OR ${effectiveDateExpr} < DATE '${minDate}'
       OR ${effectiveDateExpr} > CURRENT_DATE
  `)
  return result.count ?? 0
}

async function main() {
  const { dryRun } = parseArgs()
  const url = await pickDatabaseUrl(postgres, '[retention]')
  const db = postgres(url, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 60,
    connection: { statement_timeout: 1_800_000 },
  })

  try {
    const tables = await listBrandTables(db)
    console.log(`[retention] scanning ${tables.length} Hyundai/Platinum tables`)
    console.log(`[retention] full history: ${FULL_HISTORY_START} .. today`)
    console.log(`[retention] other tables: ${RECENT_START} .. today`)

    const results = []
    for (const tableName of tables) {
      const analysis = await analyzeTable(db, tableName)
      results.push(analysis)
      if (analysis.skipped) {
        console.log(`[retention] ${tableName}: SKIP (${analysis.reason})`)
        continue
      }
      console.log(
        `[retention] ${tableName} [${analysis.policy}]: total=${analysis.totalRows} delete=${analysis.deleteRows} keep=${analysis.keepRows} range=${analysis.minDateBefore ?? '—'}..${analysis.maxDateBefore ?? '—'}`,
      )
      if (!dryRun && analysis.deleteRows > 0) {
        const deleted = await deleteOutOfRange(db, tableName, analysis.effectiveDateExpr, analysis.minDate)
        console.log(`[retention] ${tableName}: deleted ${deleted}`)
      }
    }

    if (!dryRun) {
      const touched = results.filter((row) => !row.skipped && row.deleteRows > 0)
      for (const row of touched) {
        await db.unsafe(`VACUUM ANALYZE public."${row.tableName}"`)
        console.log(`[retention] vacuumed ${row.tableName}`)
      }
    }

    const totalDelete = results.reduce((sum, row) => sum + (row.deleteRows || 0), 0)
    const totalKeep = results.reduce((sum, row) => sum + (row.keepRows || row.totalRows || 0), 0)
    console.log(`[retention] ${dryRun ? 'dry-run' : 'complete'}: would_delete=${totalDelete} keep~=${totalKeep}`)
  } finally {
    await db.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('[retention] failed', error.message)
  process.exit(1)
})
