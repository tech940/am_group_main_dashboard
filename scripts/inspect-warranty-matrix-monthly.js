/**
 * Verify Total Claim Amount monthly breakdown reconciles with dealer totals.
 */
require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

function text(value) {
  return String(value || '').trim()
}

function num(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeBusinessDate(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return null
}

function resolveBreakdownYear(rows, fallbackYear) {
  const yearCounts = new Map()
  for (const row of rows) {
    const year = row.businessDate?.slice(0, 4)
    if (!year) continue
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1)
  }
  if (yearCounts.size === 0) return fallbackYear
  return [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

async function main() {
  const url = await pickDatabaseUrl(postgres, '[warranty-matrix]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const currentYear = new Date().getFullYear().toString()

  const rows = await db.unsafe(`
    SELECT source_dealer_code, claim_date, r_o_date, uploaded_at, total_amt, status
    FROM hyundai_warranty_claim_list
  `)

  const enriched = rows.map((row) => ({
    dealerCode: text(row.source_dealer_code).toUpperCase() || 'UNMAPPED',
    businessDate: normalizeBusinessDate(row.claim_date)
      ?? normalizeBusinessDate(row.r_o_date)
      ?? normalizeBusinessDate(row.uploaded_at),
    total_amt: num(row.total_amt),
    status: text(row.status),
  }))

  const byDealer = new Map()
  for (const row of enriched) {
    const bucket = byDealer.get(row.dealerCode) || []
    bucket.push(row)
    byDealer.set(row.dealerCode, bucket)
  }

  const topDealers = [...byDealer.entries()]
    .map(([code, dealerRows]) => ({
      code,
      total: dealerRows.reduce((sum, row) => sum + row.total_amt, 0),
      rows: dealerRows,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  console.log('Top dealers monthly reconciliation:')
  for (const dealer of topDealers) {
    const breakdownYear = resolveBreakdownYear(dealer.rows, currentYear)
    const breakdownRows = dealer.rows.filter((row) => row.businessDate?.slice(0, 4) === breakdownYear)
    const monthlySum = breakdownRows.reduce((sum, row) => sum + row.total_amt, 0)
    const yearDist = {}
    for (const row of dealer.rows) {
      const year = row.businessDate?.slice(0, 4) || 'null'
      yearDist[year] = (yearDist[year] || 0) + 1
    }
    console.log({
      dealer: dealer.code,
      parentTotal: dealer.total,
      breakdownYear,
      breakdownMonthlySum: monthlySum,
      breakdownRows: breakdownRows.length,
      yearDist,
    })
  }

  await db.end()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
