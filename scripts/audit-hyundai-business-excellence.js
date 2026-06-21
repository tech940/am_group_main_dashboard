const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

const TABLES = [
  'hyundai_ro_billing_report',
  'hyundai_repair_order_list',
  'hyundai_operation_wise_analysis_report',
  'hyundai_adv_wise_lubricants_vas',
  'hyundai_ew_report',
  'am_hyundai_rsa_report',
  'am_hyundai_mcp_report',
  'hyundai_call_center_complaints',
  'am_hyundai_workshop_performance_jc_summary_v1',
]

const DATE_CANDIDATES = [
  'bill_date',
  'r_o_date',
  'ro_date',
  'report_period_start',
  'report_period_end',
  'gst_invoice_date',
  'invoice_date',
  'reg_date',
  'package_purchase_date',
  'complaint_date',
  'resolving_date',
  'dealer_resolving_date',
  'close_date',
  'report_date',
  'uploaded_at',
]

const DEALER_CANDIDATES = [
  'source_dealer_code',
  'dealer_code',
  'main_dealer_code',
  'dealer',
  'main_dealer',
  'dlr_no',
]

const VOCABULARY_CANDIDATES = [
  'bill_type',
  'work_type',
  'r_o_status',
  'status',
  'department',
  'report_type',
  'service_advisor',
]

function databaseUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function relationExists(db, table) {
  const [row] = await db`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists`
  return Boolean(row?.exists)
}

async function columnsFor(db, table) {
  return db`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `
}

async function estimatedRows(db, table) {
  const [row] = await db`
    SELECT COALESCE(c.reltuples, 0)::bigint AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${table}
  `
  return Number(row?.estimated_rows || 0)
}

async function columnStats(db, table, column) {
  const qTable = quoteIdentifier(table)
  const qColumn = quoteIdentifier(column)
  const [row] = await db.unsafe(`
    SELECT
      MIN(${qColumn})::text AS min_value,
      MAX(${qColumn})::text AS max_value,
      COUNT(*) FILTER (WHERE ${qColumn} IS NULL)::bigint AS null_rows
    FROM ${qTable}
  `)
  return {
    min: row?.min_value ?? null,
    max: row?.max_value ?? null,
    nullRows: Number(row?.null_rows || 0),
  }
}

async function topValues(db, table, column) {
  const qTable = quoteIdentifier(table)
  const qColumn = quoteIdentifier(column)
  const rows = await db.unsafe(`
    SELECT NULLIF(TRIM(${qColumn}::text), '') AS value, COUNT(*)::bigint AS rows
    FROM ${qTable}
    GROUP BY 1
    ORDER BY rows DESC NULLS LAST
    LIMIT 30
  `)
  return rows.map((row) => ({ value: row.value, rows: Number(row.rows || 0) }))
}

async function duplicateDiagnostics(db, table, columns) {
  const qTable = quoteIdentifier(table)
  if (table === 'hyundai_ro_billing_report') {
    const [row] = await db.unsafe(`
      WITH grouped AS (
        SELECT
          UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(main_dealer_code, ''), ''))) AS dealer,
          bill_date::date AS bill_date,
          COALESCE(NULLIF(TRIM(bill_no), ''), NULLIF(TRIM(r_o_no), ''), id::text) AS invoice_key,
          COUNT(*) AS rows,
          COUNT(DISTINCT COALESCE(labour_amt, 0)::text || '|' || COALESCE(part_amt, 0)::text) AS amount_variants
        FROM ${qTable}
        GROUP BY 1, 2, 3
      )
      SELECT
        COUNT(*) FILTER (WHERE rows > 1)::bigint AS duplicate_invoice_groups,
        COUNT(*) FILTER (WHERE amount_variants > 1)::bigint AS conflicting_amount_groups,
        MAX(rows)::int AS largest_group
      FROM grouped
    `)
    return row || {}
  }

  if (columns.has('row_hash')) {
    const [row] = await db.unsafe(`
      WITH grouped AS (
        SELECT row_hash, COUNT(*) AS rows
        FROM ${qTable}
        WHERE NULLIF(row_hash, '') IS NOT NULL
        GROUP BY row_hash
      )
      SELECT COUNT(*) FILTER (WHERE rows > 1)::bigint AS duplicate_hash_groups,
             MAX(rows)::int AS largest_group
      FROM grouped
    `)
    return row || {}
  }
  return {}
}

async function sampleRows(db, table) {
  const qTable = quoteIdentifier(table)
  return db.unsafe(`
    SELECT *
    FROM ${qTable}
    ORDER BY uploaded_at DESC NULLS LAST
    LIMIT 5
  `)
}

async function analyzeTable(db, table) {
  if (!(await relationExists(db, table))) return { table, exists: false }

  const columns = await columnsFor(db, table)
  const names = new Set(columns.map((column) => column.column_name))
  const dates = DATE_CANDIDATES.filter((column) => names.has(column))
  const dealers = DEALER_CANDIDATES.filter((column) => names.has(column))
  const vocabularies = VOCABULARY_CANDIDATES.filter((column) => names.has(column))

  const [dateStats, dealerValues, vocabularyValues, samples, duplicates] = await Promise.all([
    Promise.all(dates.map(async (column) => [column, await columnStats(db, table, column)])),
    Promise.all(dealers.map(async (column) => [column, await topValues(db, table, column)])),
    Promise.all(vocabularies.map(async (column) => [column, await topValues(db, table, column)])),
    sampleRows(db, table),
    duplicateDiagnostics(db, table, names),
  ])

  return {
    table,
    exists: true,
    estimatedRows: await estimatedRows(db, table),
    columns,
    dateStats: Object.fromEntries(dateStats),
    dealerValues: Object.fromEntries(dealerValues),
    vocabularyValues: Object.fromEntries(vocabularyValues),
    duplicates,
    samples,
  }
}

async function main() {
  const db = postgres(databaseUrl(), {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 10,
    connection: {
      application_name: 'audit_hyundai_business_excellence',
      statement_timeout: 600_000,
    },
  })

  try {
    const tables = []
    for (const table of TABLES) {
      console.log(`[hyundai-audit] ${table}`)
      tables.push(await analyzeTable(db, table))
    }
    const report = {
      generatedAt: new Date().toISOString(),
      tables,
    }
    const output = path.join(process.cwd(), 'scratch', 'hyundai-business-excellence-source-audit.json')
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`[hyundai-audit] wrote ${output}`)
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('[hyundai-audit] failed', error)
  process.exit(1)
})
