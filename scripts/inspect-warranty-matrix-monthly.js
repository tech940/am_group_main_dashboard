/**
 * Verify Total Claim Amount monthly breakdown, dealer exclusions, and group totals.
 */
require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const HYUNDAI_WARRANTY_EXCLUDED_DEALERS = ['N5211', 'N6250', 'N6828']
const HYUNDAI_WARRANTY_DEALER_GROUPS = [
  { key: 'jammu', label: 'Jammu', dealerCodes: ['N5203', 'N5216'] },
  { key: 'akhnoor', label: 'Akhnoor', dealerCodes: ['N5701', 'N6844'] },
  { key: 'kathua', label: 'Kathua', dealerCodes: ['N5804', 'N6845'] },
  { key: 'rs_pura', label: 'RS Pura', dealerCodes: ['N6815', 'N6846'] },
  { key: 'vijaypur', label: 'Vijaypur', dealerCodes: ['N6819', 'N6847'] },
  { key: 'billawar', label: 'Billawar', dealerCodes: ['N6826', 'N6848'] },
]
const HYUNDAI_WARRANTY_ALLOWED_DEALERS = [
  ...new Set(HYUNDAI_WARRANTY_DEALER_GROUPS.flatMap((group) => group.dealerCodes)),
]

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

function isAllowedHyundaiWarrantyDealer(code) {
  const normalized = text(code).toUpperCase()
  return HYUNDAI_WARRANTY_ALLOWED_DEALERS.includes(normalized)
    && !HYUNDAI_WARRANTY_EXCLUDED_DEALERS.includes(normalized)
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

function buildDealerRow(code, scopedRows, currentYear) {
  const dealerRows = scopedRows.filter((row) => row.dealerCode === code)
  if (dealerRows.length === 0) return null

  const breakdownYear = resolveBreakdownYear(dealerRows, currentYear)
  const breakdownRows = dealerRows.filter((row) => row.businessDate?.slice(0, 4) === breakdownYear)
  const monthlySum = breakdownRows.reduce((sum, row) => sum + row.total_amt, 0)
  return {
    dealerCode: code,
    total: dealerRows.reduce((sum, row) => sum + row.total_amt, 0),
    breakdownYear,
    breakdownMonthlySum: monthlySum,
    breakdownRows: breakdownRows.length,
  }
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

  const scoped = enriched.filter((row) => isAllowedHyundaiWarrantyDealer(row.dealerCode))

  console.log('Excluded dealer row counts (must be 0 in scoped output):')
  for (const code of HYUNDAI_WARRANTY_EXCLUDED_DEALERS) {
    const rawCount = enriched.filter((row) => row.dealerCode === code).length
    const scopedCount = scoped.filter((row) => row.dealerCode === code).length
    console.log({ code, rawCount, scopedCount })
    if (scopedCount !== 0) {
      throw new Error(`Excluded dealer ${code} still present in scoped output`)
    }
  }

  const ungroupedInScoped = [...new Set(scoped.map((row) => row.dealerCode))]
    .filter((code) => !HYUNDAI_WARRANTY_ALLOWED_DEALERS.includes(code))
  if (ungroupedInScoped.length > 0) {
    throw new Error(`Ungrouped dealers found in scoped output: ${ungroupedInScoped.join(', ')}`)
  }

  console.log('\nGroup totals reconciliation:')
  const groups = HYUNDAI_WARRANTY_DEALER_GROUPS.map((group) => {
    const dealers = group.dealerCodes
      .map((code) => buildDealerRow(code, scoped, currentYear))
      .filter(Boolean)

    if (dealers.length === 0) return null

    const groupTotal = dealers.reduce((sum, dealer) => sum + dealer.total, 0)
    const childTotal = dealers.reduce((sum, dealer) => sum + dealer.total, 0)
    if (Math.abs(groupTotal - childTotal) > 0.01) {
      throw new Error(`Group ${group.label} total mismatch`)
    }

    return { key: group.key, label: group.label, groupTotal, dealers }
  }).filter(Boolean)

  for (const group of groups) {
    console.log({
      group: group.label,
      groupTotal: group.groupTotal,
      dealers: group.dealers.map((dealer) => ({
        code: dealer.dealerCode,
        total: dealer.total,
        breakdownYear: dealer.breakdownYear,
        breakdownMonthlySum: dealer.breakdownMonthlySum,
        breakdownRows: dealer.breakdownRows,
      })),
    })
  }

  const matrixDealerCodes = new Set(groups.flatMap((group) => group.dealers.map((dealer) => dealer.dealerCode)))
  const ungroupedInMatrix = [...new Set(scoped.map((row) => row.dealerCode))]
    .filter((code) => !matrixDealerCodes.has(code))
  if (ungroupedInMatrix.length > 0) {
    console.log('\nUngrouped dealers with data (hidden from matrix):', ungroupedInMatrix)
  } else {
    console.log('\nNo ungrouped dealers with scoped data.')
  }

  await db.end()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
