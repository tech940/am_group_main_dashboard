require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const TABLE = 'adv_wise_lubricants_vas'
const KEEP_START = '2025-01-01'
const dryRun = process.argv.includes('--dry-run')

const effectiveDateSql = `gst_invoice_date::date`

async function main() {
  const url = await pickDatabaseUrl(postgres, '[adv-retention]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const [stats] = await db.unsafe(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE ${effectiveDateSql} < DATE '${KEEP_START}')::bigint AS delete_before_2025,
      COUNT(*) FILTER (WHERE ${effectiveDateSql} > CURRENT_DATE)::bigint AS delete_future,
      COUNT(*) FILTER (
        WHERE ${effectiveDateSql} >= DATE '${KEEP_START}'
          AND ${effectiveDateSql} <= CURRENT_DATE
      )::bigint AS keep_rows,
      MIN(${effectiveDateSql})::text AS min_date,
      MAX(${effectiveDateSql})::text AS max_date
    FROM public."${TABLE}"
  `)

  console.log({
    keepFrom: KEEP_START,
    total: Number(stats.total),
    deleteBefore2025: Number(stats.delete_before_2025),
    deleteFuture: Number(stats.delete_future),
    keepRows: Number(stats.keep_rows),
    dateRange: `${stats.min_date} .. ${stats.max_date}`,
    dryRun,
  })

  const [gstStats] = await db.unsafe(`
    SELECT
      COUNT(*) FILTER (WHERE gst_invoice_date IS NULL)::bigint AS no_gst,
      COUNT(*) FILTER (
        WHERE gst_invoice_date >= DATE '${KEEP_START}'
          AND gst_invoice_date <= CURRENT_DATE
      )::bigint AS gst_in_window
    FROM public."${TABLE}"
  `)
  console.log({
    rowsWithoutGstInvoiceDate: Number(gstStats.no_gst),
    rowsWithGstInWindow: Number(gstStats.gst_in_window),
  })

  if (!dryRun) {
    const deleted = await db.unsafe(`
      DELETE FROM public."${TABLE}"
      WHERE ${effectiveDateSql} IS NULL
         OR ${effectiveDateSql} < DATE '${KEEP_START}'
         OR ${effectiveDateSql} > CURRENT_DATE
    `)
    const [after] = await db.unsafe(`SELECT COUNT(*)::bigint AS count FROM public."${TABLE}"`)
    console.log('deleted:', deleted.count ?? 0, 'remaining:', Number(after.count))
  }

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
