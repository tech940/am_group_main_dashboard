import {
  platinumComparisonGrowth,
} from '@/lib/platinum/business-excellence-calculations'
import {
  emptyPlatinumRoBillingAudit,
  fetchPlatinumRoBillingAudit,
  type PlatinumRoBillingAudit,
} from '@/lib/platinum/ro-billing-audit'

export type PlatinumComparisonParams = {
  preset: string | null
  comparisonMode: string | null
  comparisonStartDate: string | null
  comparisonEndDate: string | null
}

export type PlatinumComparisonRange = {
  startDate: string
  endDate: string
  source: string
}

export type PlatinumRoBillingPeriodMetrics = {
  dedupedJc: number
  labour: number
  parts: number
  revenue: number
}

export type PlatinumCanonicalRoBillingMetrics = {
  sourceAvailable: boolean
  cy: PlatinumRoBillingPeriodMetrics
  ly: PlatinumRoBillingPeriodMetrics
  lyRange: PlatinumComparisonRange
  audit: PlatinumRoBillingAudit
}

export type PlatinumComparisonMetric = {
  cy: number
  ly: number
  deltaPct: number | null
  comparisonStatus: 'available' | 'exact_zero' | 'not_comparable' | 'source_missing' | 'period_mismatch'
  comparisonLabel: string | null
  unavailableReason: string | null
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function sameDateLastYear(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return toDateInputValue(new Date(year - 1, month - 1, day))
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function sameQuarterToDateLastYear(endDate: string) {
  const { year, month } = parseDateParts(endDate)
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3
  return {
    startDate: toDateInputValue(new Date(year - 1, quarterStartMonth, 1)),
    endDate: sameDateLastYear(endDate),
  }
}

function yearToDateLastYear(startDate: string, endDate: string) {
  const { year } = parseDateParts(startDate)
  return {
    startDate: `${year - 1}-01-01`,
    endDate: sameDateLastYear(endDate),
  }
}

function fullPreviousFinancialYear(value: string) {
  const { year, month } = parseDateParts(value)
  const currentFinancialYearStart = month >= 4 ? year : year - 1
  return {
    startDate: `${currentFinancialYearStart - 1}-04-01`,
    endDate: `${currentFinancialYearStart}-03-31`,
  }
}

function isMonthAnchoredRange(startDate: string, endDate: string) {
  const start = parseDateParts(startDate)
  const end = parseDateParts(endDate)
  return start.day === 1 && start.year === end.year && start.month === end.month
}

export function resolvePlatinumComparisonRange(
  startDate: string,
  endDate: string,
  comparison: PlatinumComparisonParams
): PlatinumComparisonRange {
  if (comparison.comparisonStartDate && comparison.comparisonEndDate) {
    return {
      startDate: comparison.comparisonStartDate,
      endDate: comparison.comparisonEndDate,
      source: 'custom',
    }
  }

  if (comparison.preset === 'qtd' || comparison.preset === 'current_quarter') {
    return { ...sameQuarterToDateLastYear(endDate), source: 'same-quarter-to-date-ly' }
  }

  if (comparison.preset === 'ytd') {
    return { ...yearToDateLastYear(startDate, endDate), source: 'year-to-date-ly' }
  }

  if (comparison.preset === 'current_fy') {
    return { ...fullPreviousFinancialYear(startDate), source: 'full-financial-year-ly' }
  }

  if (comparison.preset === 'mtd' || comparison.preset === 'current_month' || isMonthAnchoredRange(startDate, endDate)) {
    return {
      startDate: sameDateLastYear(startDate),
      endDate: sameDateLastYear(endDate),
      source: 'same-month-to-date-ly',
    }
  }

  return {
    startDate: sameDateLastYear(startDate),
    endDate: sameDateLastYear(endDate),
    source: 'same-dates-ly',
  }
}

export function perUnit(amount: number, count: number) {
  return count > 0 ? amount / count : 0
}

export function comparisonStatus(previous: number, status: 'available' | 'not_comparable' | 'source_missing' = 'available') {
  if (status !== 'available') return status
  return previous === 0 ? 'exact_zero' : 'available'
}

export function roBillingComparisonStatus(previous: number, hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? comparisonStatus(previous) : 'not_comparable'
}

export function roBillingDelta(current: number, previous: number, hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? platinumComparisonGrowth(current, previous) : null
}

export function roBillingComparisonLabel(hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? null : 'No selected-range data'
}

export function roBillingUnavailableReason(hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? null : 'No RO Billing rows exist for the selected dealer/date range'
}

export function buildRoBillingComparisonMetric(
  cy: number,
  ly: number,
  hasSelectedRangeData: boolean
): PlatinumComparisonMetric {
  return {
    cy,
    ly,
    deltaPct: roBillingDelta(cy, ly, hasSelectedRangeData),
    comparisonStatus: roBillingComparisonStatus(ly, hasSelectedRangeData),
    comparisonLabel: roBillingComparisonLabel(hasSelectedRangeData),
    unavailableReason: roBillingUnavailableReason(hasSelectedRangeData),
  }
}

export async function fetchCanonicalRoBillingMetrics({
  cyStart,
  cyEnd,
  lyStart,
  lyEnd,
  dealerCode = null,
}: {
  cyStart: string
  cyEnd: string
  lyStart: string
  lyEnd: string
  dealerCode?: string | null
}): Promise<PlatinumCanonicalRoBillingMetrics> {
  const audit = await fetchPlatinumRoBillingAudit(cyStart, cyEnd, dealerCode, {
    lyStartDate: lyStart,
    lyEndDate: lyEnd,
  })

  const emptyPeriod: PlatinumRoBillingPeriodMetrics = {
    dedupedJc: 0,
    labour: 0,
    parts: 0,
    revenue: 0,
  }

  if (!audit.sourceAvailable) {
    return {
      sourceAvailable: false,
      cy: emptyPeriod,
      ly: emptyPeriod,
      lyRange: {
        startDate: lyStart,
        endDate: lyEnd,
        source: 'unavailable',
      },
      audit: emptyPlatinumRoBillingAudit(cyStart, cyEnd, dealerCode, false, {
        lyStartDate: lyStart,
        lyEndDate: lyEnd,
      }),
    }
  }

  return {
    sourceAvailable: true,
    cy: {
      dedupedJc: audit.dedupedJc,
      labour: audit.labour,
      parts: audit.parts,
      revenue: audit.revenue,
    },
    ly: {
      dedupedJc: audit.ly.dedupedJc,
      labour: audit.ly.labour,
      parts: audit.ly.parts,
      revenue: audit.ly.revenue,
    },
    lyRange: {
      startDate: audit.ly.startDate,
      endDate: audit.ly.endDate,
      source: 'canonical-audit',
    },
    audit,
  }
}
