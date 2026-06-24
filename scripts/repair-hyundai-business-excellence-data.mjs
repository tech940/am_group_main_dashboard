import 'dotenv/config'
import postgres from 'postgres'

const APPLY_TOKEN = 'REPAIR_HYUNDAI_BE'
const apply = process.argv.includes('--apply')
const confirmed = process.argv.includes(`--confirm=${APPLY_TOKEN}`)

if (apply && !confirmed) {
  throw new Error(`Refusing to mutate data without --confirm=${APPLY_TOKEN}`)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  idle_timeout: 30,
  connect_timeout: 30,
})

const specs = [
  {
    key: 'billing',
    table: 'hyundai_ro_billing_report',
    recovery: 'hyundai_ro_billing_report_backup_20260624',
    dateExpression: 'bill_date',
    expectedRows: 134485,
  },
  {
    key: 'repair',
    table: 'hyundai_repair_order_list',
    recovery: 'hyundai_repair_order_list_backup_20260624',
    dateExpression: 'COALESCE(r_o_date, ro_date)',
    expectedRows: 170132,
  },
  {
    key: 'operation',
    table: 'hyundai_operation_wise_analysis_report',
    recovery: 'hyundai_operation_wise_analysis_report_backup_20260624',
    dateExpression: 'report_period_end',
    expectedRows: 34979,
  },
]

const dealerColumns = new Set([
  'source_dealer_code',
  'dealer_code',
  'main_dealer_code',
  'dlr_no',
  'dealer_code_2',
  'sale_dealer_code',
])

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function normalizeDealerExpression(column) {
  const quoted = quoteIdentifier(column)
  return `CASE UPPER(TRIM(COALESCE(${quoted}::text, '')))
    WHEN 'N5203' THEN 'N5216'
    WHEN 'N5701' THEN 'N6844'
    WHEN 'N5804' THEN 'N6845'
    WHEN 'N6815' THEN 'N6846'
    WHEN 'N6819' THEN 'N6847'
    WHEN 'N6826' THEN 'N6848'
    WHEN 'N6828' THEN 'N6848'
    ELSE ${quoted}
  END`
}

async function relationExists(name) {
  const [row] = await sql`SELECT to_regclass(${'public.' + name}) IS NOT NULL AS exists`
  return Boolean(row?.exists)
}

async function columnsFor(table) {
  return sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
    ORDER BY ordinal_position
  `
}

function buildRecoverySql(spec, columns, stageTable) {
  const normalizedColumns = columns
    .filter((column) => column !== 'row_hash')
    .map((column) => {
      if (dealerColumns.has(column)) {
        return `${normalizeDealerExpression(column)} AS ${quoteIdentifier(column)}`
      }
      return quoteIdentifier(column)
    })

  const finalColumns = columns.map(quoteIdentifier).join(', ')
  const rankedColumns = columns
    .map((column) => column === 'row_hash' ? 'safe_row_hash AS row_hash' : quoteIdentifier(column))
    .join(', ')
  const resolvedDealer = spec.key === 'repair'
    ? `COALESCE(
        NULLIF(UPPER(TRIM(source_dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer)), ''),
        NULLIF(UPPER(TRIM(dlr_no)), '')
      )`
    : `COALESCE(
        NULLIF(UPPER(TRIM(source_dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer_code)), '')
      )`

  return `
    INSERT INTO ${quoteIdentifier(stageTable)} (${finalColumns})
    WITH normalized AS (
      SELECT ${normalizedColumns.join(', ')}
      FROM ${quoteIdentifier(spec.recovery)}
    ),
    filtered AS (
      SELECT *
      FROM normalized
      WHERE ${resolvedDealer} IN ('N5216', 'N6844', 'N6845', 'N6846', 'N6847', 'N6848')
    ),
    fingerprinted AS (
      SELECT
        filtered.*,
        encode(
          digest(
            ((to_jsonb(filtered) - 'id') - 'uploaded_at')::text,
            'sha256'
          ),
          'hex'
        ) AS safe_row_hash
      FROM filtered
    ),
    ranked AS (
      SELECT DISTINCT ON (safe_row_hash)
        ${rankedColumns}
      FROM fingerprinted
      ORDER BY safe_row_hash, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT ${finalColumns}
    FROM ranked
  `
}

async function tableSummary(table, dateExpression) {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS rows,
      COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      MIN(${dateExpression})::date AS min_date,
      MAX(${dateExpression})::date AS max_date
    FROM ${quoteIdentifier(table)}
  `)
  return row
}

async function dealerSummary(table, dateExpression) {
  const dealerExpression = table === 'hyundai_repair_order_list'
    ? `COALESCE(
        NULLIF(UPPER(TRIM(source_dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer)), ''),
        NULLIF(UPPER(TRIM(dlr_no)), '')
      )`
    : `COALESCE(
        NULLIF(UPPER(TRIM(source_dealer_code)), ''),
        NULLIF(UPPER(TRIM(dealer_code)), '')
      )`

  return sql.unsafe(`
    SELECT
      ${dealerExpression} AS dealer_code,
      COUNT(*)::int AS rows,
      MIN(${dateExpression})::date AS min_date,
      MAX(${dateExpression})::date AS max_date
    FROM ${quoteIdentifier(table)}
    GROUP BY 1
    ORDER BY 1
  `)
}

async function buildStage(spec, timestamp) {
  if (!(await relationExists(spec.table))) throw new Error(`${spec.table} does not exist`)
  if (!(await relationExists(spec.recovery))) throw new Error(`${spec.recovery} does not exist`)

  const columns = (await columnsFor(spec.table)).map((row) => String(row.column_name))
  const stageTable = `hbe_stage_${spec.key}_${timestamp}`

  await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(stageTable)}`)
  await sql.unsafe(
    `CREATE UNLOGGED TABLE ${quoteIdentifier(stageTable)} (LIKE ${quoteIdentifier(spec.table)} INCLUDING DEFAULTS)`,
  )
  await sql.unsafe(buildRecoverySql(spec, columns, stageTable))

  const summary = await tableSummary(stageTable, spec.dateExpression)
  if (summary.rows !== spec.expectedRows) {
    throw new Error(
      `${spec.table} staging row count ${summary.rows} does not match expected ${spec.expectedRows}`,
    )
  }
  if (summary.rows !== summary.distinct_hashes) {
    throw new Error(`${spec.table} staging contains duplicate safe hashes`)
  }

  return { ...spec, columns, stageTable, summary }
}

async function main() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`
  await sql`SET statement_timeout = 0`

  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const stages = []

  try {
    for (const spec of specs) {
      const current = await tableSummary(spec.table, spec.dateExpression)
      const stage = await buildStage(spec, timestamp)
      stages.push(stage)
      console.log(JSON.stringify({
        table: spec.table,
        mode: apply ? 'apply' : 'dry-run',
        current,
        projected: stage.summary,
        projectedDealers: await dealerSummary(stage.stageTable, spec.dateExpression),
      }, null, 2))
    }

    if (!apply) {
      console.log(`Dry run complete. Re-run with --apply --confirm=${APPLY_TOKEN} to replace active data.`)
      return
    }

    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL statement_timeout = 0`

      for (const stage of stages) {
        const snapshot = `hbe_pre_${stage.key}_${timestamp}`
        const columnList = stage.columns.map(quoteIdentifier).join(', ')

        await transaction.unsafe(`LOCK TABLE ${quoteIdentifier(stage.table)} IN ACCESS EXCLUSIVE MODE`)
        await transaction.unsafe(
          `CREATE TABLE ${quoteIdentifier(snapshot)} AS TABLE ${quoteIdentifier(stage.table)}`,
        )
        await transaction.unsafe(`TRUNCATE TABLE ${quoteIdentifier(stage.table)}`)
        await transaction.unsafe(`
          INSERT INTO ${quoteIdentifier(stage.table)} (${columnList})
          SELECT ${columnList}
          FROM ${quoteIdentifier(stage.stageTable)}
        `)
        await transaction.unsafe(`
          SELECT setval(
            pg_get_serial_sequence('public.${stage.table}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(stage.table)}), 1),
            true
          )
        `)
      }
    })

    for (const stage of stages) {
      const actual = await tableSummary(stage.table, stage.dateExpression)
      if (
        actual.rows !== stage.summary.rows
        || actual.distinct_hashes !== stage.summary.distinct_hashes
      ) {
        throw new Error(`${stage.table} post-repair reconciliation failed`)
      }
      console.log(JSON.stringify({
        table: stage.table,
        repaired: actual,
        dealers: await dealerSummary(stage.table, stage.dateExpression),
      }, null, 2))
    }
  } finally {
    for (const stage of stages) {
      await sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(stage.stageTable)}`)
    }
    await sql.end()
  }
}

await main()
