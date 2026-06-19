import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from '../scripts/bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[platinum-history-audit]')
const db = postgres(url, {
  ssl: { rejectUnauthorized: false },
  prepare: false,
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
})

const dealer = (fallbacks = []) => {
  const candidates = [
    `NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE')`,
    ...fallbacks.map((column) => `NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), '')`),
  ]
  const resolved = `COALESCE(${candidates.join(', ')})`
  return `CASE WHEN ${resolved} = 'N6824' THEN 'N6250' ELSE ${resolved} END`
}

const roDealer = dealer(['dealer_code', 'main_dealer_code'])
const repairDealer = dealer(['dealer_code'])
const sourceDealer = dealer()

async function query(text) {
  const results = await db.unsafe(`SET statement_timeout TO '45000ms'; ${text}`)
  return results[1] || results
}

function monthKey(value) {
  return String(value || '').slice(0, 7)
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function groupBy(rows, key) {
  const grouped = new Map()
  for (const row of rows) {
    const value = row[key] ?? 'UNMAPPED'
    if (!grouped.has(value)) grouped.set(value, [])
    grouped.get(value).push(row)
  }
  return grouped
}

function contiguousRanges(months) {
  const sorted = [...new Set(months)].sort()
  const ranges = []
  let start = null
  let previous = null
  for (const month of sorted) {
    const [year, number] = month.split('-').map(Number)
    const ordinal = year * 12 + number
    if (start === null) {
      start = month
      previous = { month, ordinal }
      continue
    }
    if (ordinal === previous.ordinal + 1) {
      previous = { month, ordinal }
      continue
    }
    ranges.push(start === previous.month ? start : `${start} to ${previous.month}`)
    start = month
    previous = { month, ordinal }
  }
  if (start !== null) ranges.push(start === previous.month ? start : `${start} to ${previous.month}`)
  return ranges
}

try {
  const [ro, repair, operation, advisor] = await Promise.all([
    query(`
      WITH ranked AS (
        SELECT ${roDealer} AS dealer,
          DATE_TRUNC('month', bill_date)::date AS month,
          bill_date::date AS report_date,
          COALESCE(labour_amt, 0)::numeric AS labour,
          COALESCE(part_amt, 0)::numeric AS parts,
          COALESCE(total_amt, 0)::numeric AS source_total,
          ROW_NUMBER() OVER (
            PARTITION BY ${roDealer}, bill_date::date,
              COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM am_platinum_ro_billing_report
        WHERE bill_date >= DATE '2021-01-01'
          AND bill_date <= CURRENT_DATE
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      )
      SELECT month::text, dealer,
        COUNT(*)::int AS raw_rows,
        COUNT(*) FILTER (WHERE row_rank = 1)::int AS invoices,
        COUNT(DISTINCT report_date)::int AS covered_dates,
        MIN(report_date)::text AS min_date, MAX(report_date)::text AS max_date,
        ROUND(SUM(labour + parts) FILTER (WHERE row_rank = 1), 2)::float AS revenue,
        ROUND(SUM(source_total) FILTER (WHERE row_rank = 1), 2)::float AS source_total,
        (COUNT(*) - COUNT(*) FILTER (WHERE row_rank = 1))::int AS duplicates
      FROM ranked
      GROUP BY month, dealer
      ORDER BY dealer, month
    `),
    query(`
      SELECT DATE_TRUNC('month', r_o_date)::date::text AS month, ${repairDealer} AS dealer,
        COUNT(*)::int AS raw_rows,
        COUNT(DISTINCT row_hash)::int AS distinct_hashes,
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text))::int AS repair_orders,
        COUNT(DISTINCT r_o_date::date)::int AS covered_dates,
        MIN(r_o_date)::text AS min_date, MAX(r_o_date)::text AS max_date
      FROM am_platinum_repair_order_list
      WHERE r_o_date >= DATE '2021-01-01' AND r_o_date <= CURRENT_DATE
      GROUP BY DATE_TRUNC('month', r_o_date), ${repairDealer}
      ORDER BY dealer, month
    `),
    query(`
      WITH ranked AS (
        SELECT ${sourceDealer} AS dealer,
          report_period_start::date AS period_start,
          report_period_end::date AS period_end,
          COALESCE(total_count, 0)::numeric AS operation_count,
          COALESCE(total_amt, 0)::numeric AS amount,
          ROW_NUMBER() OVER (
            PARTITION BY ${sourceDealer}, report_period_start::date, report_period_end::date,
              COALESCE(NULLIF(row_hash, ''), id::text)
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM am_platinum_operation_wise_analysis_report
        WHERE report_period_start >= DATE '2021-01-01'
          AND report_period_start <= CURRENT_DATE
      )
      SELECT DATE_TRUNC('month', period_start)::date::text AS month, dealer,
        COUNT(DISTINCT (period_start, period_end))::int AS snapshots,
        MIN(period_start)::text AS min_date, MAX(period_end)::text AS max_date,
        COUNT(*)::int AS raw_rows,
        COUNT(*) FILTER (WHERE row_rank = 1)::int AS deduped_rows,
        COUNT(*) FILTER (WHERE operation_count <> TRUNC(operation_count))::int AS fractional_count_rows,
        ROUND(SUM(operation_count) FILTER (WHERE row_rank = 1), 2)::float AS operation_count,
        ROUND(SUM(amount) FILTER (WHERE row_rank = 1), 2)::float AS amount
      FROM ranked
      GROUP BY DATE_TRUNC('month', period_start), dealer
      ORDER BY dealer, month
    `),
    query(`
      SELECT ${sourceDealer} AS dealer,
        COUNT(*)::int AS raw_rows,
        COUNT(DISTINCT row_hash)::int AS distinct_hashes,
        ROUND(SUM(COALESCE(total_count, 0)), 2)::float AS total_count,
        ROUND(SUM(COALESCE(total_amt, 0)), 2)::float AS total_amount,
        MIN(uploaded_at)::text AS first_upload,
        MAX(uploaded_at)::text AS latest_upload
      FROM am_platinum_adv_wise_lubricants_vas
      GROUP BY ${sourceDealer}
      ORDER BY dealer
    `),
  ])

  const repairIndex = new Map(repair.map((row) => [`${row.dealer}:${monthKey(row.month)}`, row]))
  const operationIndex = new Map(operation.map((row) => [`${row.dealer}:${monthKey(row.month)}`, row]))
  const audit = {}

  for (const [dealerCode, dealerRows] of groupBy(ro, 'dealer')) {
    const completeHistorical = dealerRows.filter((row) => {
      const month = monthKey(row.month)
      return month >= '2021-01' && month < '2026-06' && Number(row.covered_dates) >= 20
    })
    const medianInvoices = median(completeHistorical.map((row) => Number(row.invoices)))
    const medianRevenue = median(completeHistorical.map((row) => Number(row.revenue)))
    const flags = []

    for (const row of dealerRows) {
      const month = monthKey(row.month)
      const repairRow = repairIndex.get(`${dealerCode}:${month}`)
      const operationRow = operationIndex.get(`${dealerCode}:${month}`)
      const reasons = []
      const invoices = Number(row.invoices)
      const revenue = Number(row.revenue)
      const coveredDates = Number(row.covered_dates)
      const isCurrentPartial = month === '2026-06'

      if (!isCurrentPartial && coveredDates < 15) reasons.push(`RO Billing covers only ${coveredDates} dates`)
      if (!isCurrentPartial && medianInvoices > 0 && invoices < medianInvoices * 0.25) {
        reasons.push(`RO Billing invoices ${invoices} are below 25% of dealer median ${Math.round(medianInvoices)}`)
      }
      if (!isCurrentPartial && medianRevenue > 0 && revenue < medianRevenue * 0.2) {
        reasons.push(`RO Billing revenue ₹${Math.round(revenue)} is below 20% of dealer median ₹${Math.round(medianRevenue)}`)
      }
      if (Number(row.duplicates) > 0) reasons.push(`${row.duplicates} duplicate invoice rows`)

      if (!repairRow) {
        reasons.push('Repair Order month missing')
      } else {
        const ratio = invoices > 0 ? Number(repairRow.repair_orders) / invoices : 0
        if (!isCurrentPartial && ratio < 0.5) {
          reasons.push(`Repair Orders ${repairRow.repair_orders} are only ${(ratio * 100).toFixed(0)}% of billed invoices`)
        }
        if (!isCurrentPartial && Number(repairRow.covered_dates) < 15) {
          reasons.push(`Repair Orders cover only ${repairRow.covered_dates} dates`)
        }
      }

      if (!operationRow) {
        reasons.push('Operation Wise month missing')
      } else {
        const opRatio = invoices > 0 ? Number(operationRow.operation_count) / invoices : 0
        if (!isCurrentPartial && opRatio < 0.25) {
          reasons.push(`Operation Wise count ${operationRow.operation_count} is only ${(opRatio * 100).toFixed(0)}% of billed invoices`)
        }
        if (Number(operationRow.fractional_count_rows) > 0) {
          reasons.push(`${operationRow.fractional_count_rows} Operation Wise rows have fractional counts`)
        }
      }

      if (reasons.length) {
        flags.push({
          month,
          roInvoices: invoices,
          roRevenue: revenue,
          repairOrders: repairRow ? Number(repairRow.repair_orders) : null,
          operationCount: operationRow ? Number(operationRow.operation_count) : null,
          reasons,
        })
      }
    }

    const roMonths = new Set(dealerRows.map((row) => monthKey(row.month)))
    const repairMissing = dealerRows
      .map((row) => monthKey(row.month))
      .filter((month) => !repairIndex.has(`${dealerCode}:${month}`))
    const operationMissing = dealerRows
      .map((row) => monthKey(row.month))
      .filter((month) => !operationIndex.has(`${dealerCode}:${month}`))

    audit[dealerCode] = {
      roCoverage: `${monthKey(dealerRows[0]?.month)} to ${monthKey(dealerRows.at(-1)?.month)}`,
      roMonthCount: roMonths.size,
      medianInvoices: Math.round(medianInvoices),
      medianRevenue: Math.round(medianRevenue),
      repairMissingRanges: contiguousRanges(repairMissing),
      operationMissingRanges: contiguousRanges(operationMissing),
      flaggedMonths: flags,
    }
  }

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    rules: {
      roLowCoverage: '<15 distinct billing dates',
      roLowVolume: '<25% dealer median invoices',
      roLowRevenue: '<20% dealer median revenue',
      repairMismatch: '<50% of billed invoices or <15 covered dates',
      operationMismatch: '<25% of billed invoices; heuristic only because operations and invoices are different units',
    },
    audit,
    advisorLubricants: {
      issue: 'Table has no date/month/report-period column; historical periods cannot be isolated.',
      dealerTotals: advisor,
    },
  }, null, 2))
} finally {
  await db.end({ timeout: 2 })
}
