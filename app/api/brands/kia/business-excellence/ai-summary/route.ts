import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type BusinessDateFilter = {
  mode: 'month' | 'range'
  month: number
  year: number
  startDate: string
  endDate: string
} | null

type SummaryRequest = {
  report: string
  dateFilter?: BusinessDateFilter
}

type AiMetricSignal = {
  label: string
  value: string
  context: string
  tone?: 'good' | 'watch' | 'risk' | 'neutral'
}

type AiAction = {
  owner: string
  action: string
  priority?: 'High' | 'Medium' | 'Low'
}

type AiStructuredSummary = {
  title: string
  executiveRead: string
  metricSignals: AiMetricSignal[]
  keyFindings: string[]
  risks: string[]
  actions: AiAction[]
}

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const SUPPORTED_REPORTS = new Set([
  'RO Billing Report',
  'Workshop Performance',
  'Open RO (Repair Orders)',
  'Kia Complaints',
])

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isValidInputDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function getDateRange(dateFilter: BusinessDateFilter) {
  const today = new Date()

  if (dateFilter?.mode === 'range' && isValidInputDate(dateFilter.startDate) && isValidInputDate(dateFilter.endDate)) {
    return { startDate: dateFilter.startDate, endDate: dateFilter.endDate }
  }

  if (
    dateFilter?.mode === 'month'
    && Number.isInteger(dateFilter.month)
    && dateFilter.month >= 0
    && dateFilter.month <= 11
    && Number.isInteger(dateFilter.year)
  ) {
    const monthStart = new Date(dateFilter.year, dateFilter.month, 1)
    const monthEnd = dateFilter.year === today.getFullYear() && dateFilter.month === today.getMonth()
      ? today
      : new Date(dateFilter.year, dateFilter.month + 1, 0)

    return {
      startDate: toInputDate(monthStart),
      endDate: toInputDate(monthEnd),
    }
  }

  return {
    startDate: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toInputDate(today),
  }
}

function take<T>(items: T[] | undefined, limit: number) {
  return Array.isArray(items) ? items.slice(0, limit) : []
}

function takeLast<T>(items: T[] | undefined, limit: number) {
  return Array.isArray(items) ? items.slice(Math.max(items.length - limit, 0)) : []
}

function pickFields(row: unknown, fields: string[]) {
  if (!row || typeof row !== 'object') return row
  const source = row as Record<string, unknown>
  return Object.fromEntries(fields.map((field) => [field, source[field]]).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

function pickRows(rows: unknown[] | undefined, limit: number, fields: string[], fromEnd = false) {
  const selected = fromEnd ? takeLast(rows, limit) : take(rows, limit)
  return selected.map((row) => pickFields(row, fields))
}

function compactOpenRoPayload(data: Record<string, unknown>) {
  const charts = (data.charts || {}) as Record<string, unknown[]>
  const alerts = (data.alerts || {}) as Record<string, unknown[]>

  return {
    asOfDate: data.asOfDate,
    kpis: data.kpis,
    rows: pickRows(data.rows as unknown[], 8, ['serviceType', 'totalWip', 'bucket04', 'bucket57', 'bucket815', 'bucketOver15', 'avgDays']),
    agingDistribution: pickRows(charts.agingDistribution, 4, ['bucket', 'count']),
    advisorLoad: pickRows(charts.advisorLoad, 8, ['advisor', 'openRo', 'avgAging']),
    workTypeDistribution: pickRows(charts.workTypeDistribution, 6, ['name', 'value']),
    agingTrend: pickRows(charts.agingTrend, 14, ['date', 'openRo', 'avgAging'], true),
    alertSummary: pickRows(alerts.summary, 8, ['label', 'count']),
    highPriorityVehicles: pickRows(alerts.highPriority, 8, ['roNo', 'regNo', 'serviceCategory', 'advisor', 'agingDays', 'delayStatus', 'promiseDate', 'alerts']),
    meta: data.meta,
  }
}

function compactWorkshopPayload(data: Record<string, unknown>) {
  return {
    dateRange: data.dateRange,
    kpis: data.kpis,
    rows: pickRows(data.rows as unknown[], 12, ['serviceType', 'groupType', 'totalJc', 'labourAmount', 'spareSale', 'labourPerRo', 'sparePerRo', 'discount']),
    dailyTrend: pickRows(data.dailyTrend as unknown[], 14, ['date', 'totalJc', 'labourAmount', 'partAmount', 'totalRevenue'], true),
    advisors: pickRows(data.advisors as unknown[], 8, ['advisor', 'totalJc', 'labourAmount', 'partAmount', 'totalRevenue', 'avgBilling']),
    meta: data.meta,
  }
}

function compactComplaintsPayload(data: Record<string, unknown>) {
  const charts = (data.charts || {}) as Record<string, unknown[]>

  return {
    asOfDate: data.asOfDate,
    dateRange: data.dateRange,
    trendYear: data.trendYear,
    kpis: data.kpis,
    monthlyTrend: pickRows(charts.monthlyTrend, 12, ['month', 'cyCount', 'lyCount', 'growthPct']),
    primaryAreas: pickRows(charts.areaBreakdown, 8, ['name', 'total', 'open', 'avgDays']),
    subAreas: pickRows(charts.subAreaBreakdown, 8, ['name', 'total', 'open', 'avgDays']),
    dealers: pickRows(charts.dealerPerformance, 8, ['dealer', 'dealerCode', 'total', 'open', 'avgDays', 'over15']),
    models: pickRows(charts.modelBreakdown, 6, ['model', 'total', 'avgDays']),
    sources: pickRows(charts.sourceBreakdown, 6, ['source', 'total']),
    criticalRows: pickRows(data.rows as unknown[], 10, ['complaintNo', 'statusGroup', 'customerName', 'dealerCode', 'complaintDate', 'closeDate', 'srArea', 'srSubArea', 'signalArea', 'resolutionDays']),
    metadata: data.metadata,
  }
}

function compactRoBillingPayload(parts: Record<string, Record<string, unknown>>) {
  const table = parts.table || {}
  const trend = parts.trend || {}
  const byMetric = (table.byMetric || {}) as Record<string, { rows?: unknown[] }>
  const trendByMetric = (trend.byMetric || {}) as Record<string, { trend?: unknown[] }>
  const intelligence = parts.intelligence || {}
  const intelligenceMetrics = (intelligence.metrics || {}) as Record<string, unknown>

  return {
    dateRange: table.dateRange || trend.dateRange,
    metricTables: Object.fromEntries(
      Object.entries(byMetric).map(([metric, payload]) => [
        metric,
        pickRows(payload.rows, 8, ['name', 'td', 'cy', 'ly', 'growth', 'qtdCY', 'qtdLY', 'qtdGrowth', 'ytdCY', 'ytdLY', 'ytdGrowth']),
      ])
    ),
    metricTrends: Object.fromEntries(
      Object.entries(trendByMetric).map(([metric, payload]) => [
        metric,
        pickRows(payload.trend, 10, ['label', 'date', 'cy', 'ly', 'growth', 'value'], true),
      ])
    ),
    analyticsSummary: parts.analytics?.analyticsSummary,
    advisorLeaderboard: pickRows(parts.leaderboard?.advisorLeaderboard as unknown[], 8, ['advisor', 'totalRo', 'totalRevenue', 'labourAmount', 'partAmount', 'avgBilling', 'discount']),
    performanceIntelligence: {
      metrics: intelligenceMetrics,
      alertCounts: intelligenceMetrics.alertCounts,
      advisorScores: pickRows(intelligence.advisorScores as unknown[], 8, ['advisor', 'score', 'transactions', 'alerts']),
      exceptionRows: pickRows(intelligence.rows as unknown[], 8, ['type', 'date', 'model', 'regNumber', 'advisor', 'labourAmt', 'partAmt', 'discount', 'alerts', 'score']),
    },
  }
}

async function fetchJson(request: NextRequest, path: string) {
  const url = new URL(path, request.nextUrl.origin)
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      cookie: request.headers.get('cookie') || '',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to load ${url.pathname}`)
  }

  return await response.json() as Record<string, unknown>
}

async function buildReportDataset(request: NextRequest, report: string, startDate: string, endDate: string) {
  const baseParams = new URLSearchParams({ startDate, endDate })

  if (report === 'Open RO (Repair Orders)') {
    const data = await fetchJson(request, `/api/brands/kia/business-excellence/open-ro?${baseParams.toString()}`)
    return compactOpenRoPayload(data)
  }

  if (report === 'Workshop Performance') {
    const data = await fetchJson(request, `/api/brands/kia/business-excellence/workshop-performance?${baseParams.toString()}`)
    return compactWorkshopPayload(data)
  }

  if (report === 'Kia Complaints') {
    const data = await fetchJson(request, `/api/brands/kia/business-excellence/complaints?${baseParams.toString()}`)
    return compactComplaintsPayload(data)
  }

  const roParams = new URLSearchParams({
    brand: 'kia',
    sheet: 'ro_billing_report',
    startDate,
    endDate,
    groupBy: 'work_type',
  })
  const tableParams = new URLSearchParams(roParams)
  tableParams.set('analysisType', 'load')
  tableParams.set('view', 'table')
  tableParams.set('metrics', 'all')

  const trendParams = new URLSearchParams(roParams)
  trendParams.set('analysisType', 'load')
  trendParams.set('view', 'trend')
  trendParams.set('metrics', 'all')

  const analyticsParams = new URLSearchParams(roParams)
  analyticsParams.set('analysisType', 'load')
  analyticsParams.set('view', 'analytics')

  const leaderboardParams = new URLSearchParams(roParams)
  leaderboardParams.set('analysisType', 'load')
  leaderboardParams.set('view', 'leaderboard')

  const intelligenceParams = new URLSearchParams({ startDate, endDate, limit: '50' })

  const [table, trend, analytics, leaderboard, intelligence] = await Promise.all([
    fetchJson(request, `/api/brands/kia/business-excellence/ro-billing-analysis?${tableParams.toString()}`),
    fetchJson(request, `/api/brands/kia/business-excellence/ro-billing-analysis?${trendParams.toString()}`),
    fetchJson(request, `/api/brands/kia/business-excellence/ro-billing-analysis?${analyticsParams.toString()}`),
    fetchJson(request, `/api/brands/kia/business-excellence/ro-billing-analysis?${leaderboardParams.toString()}`),
    fetchJson(request, `/api/brands/kia/business-excellence/performance-intelligence?${intelligenceParams.toString()}`),
  ])

  return compactRoBillingPayload({ table, trend, analytics, leaderboard, intelligence })
}

async function createAiSummary(report: string, startDate: string, endDate: string, dataset: unknown) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured')
  }

  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are an automotive dealership business-excellence analyst.',
            'Summarize only the supplied data. Do not invent values.',
            'Write for a dealer principal, MD, service manager, or business excellence manager.',
            'Return only valid JSON, with no markdown and no code fences.',
            'Use exact numbers from the supplied dataset wherever available.',
            'Avoid generic statements like "review data"; give operational interpretation and action.',
            'JSON schema: {"title":string,"executiveRead":string,"metricSignals":[{"label":string,"value":string,"context":string,"tone":"good|watch|risk|neutral"}],"keyFindings":string[],"risks":string[],"actions":[{"owner":string,"action":string,"priority":"High|Medium|Low"}]}.',
            'Create 4 to 6 metricSignals, 5 to 7 keyFindings, 3 to 5 risks, and 3 to 5 actions.',
            'Keep the total JSON content detailed but concise.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            report,
            dateRange: { startDate, endDate },
            dataset,
          }),
        },
      ],
    }),
  })

  const payload = await response.json() as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error && typeof payload.error === 'object'
      ? String((payload.error as { message?: unknown }).message || 'Groq request failed')
      : 'Groq request failed'
    throw new Error(error)
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined
  const text = typeof firstChoice?.message?.content === 'string'
    ? firstChoice.message.content.trim()
    : ''

  if (!text) throw new Error('AI summary response was empty')
  const structuredSummary = parseStructuredSummary(text)

  return {
    summary: structuredSummary ? buildSummaryText(structuredSummary) : text,
    structuredSummary,
    model,
  }
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function asStringList(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean).slice(0, limit)
    : []
}

function parseStructuredSummary(text: string): AiStructuredSummary | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>

    const metricSignals = Array.isArray(parsed.metricSignals)
      ? parsed.metricSignals.slice(0, 6).map((item) => {
        const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const tone = asString(row.tone, 'neutral')
        return {
          label: asString(row.label, 'Metric'),
          value: asString(row.value, '-'),
          context: asString(row.context),
          tone: ['good', 'watch', 'risk', 'neutral'].includes(tone) ? tone as AiMetricSignal['tone'] : 'neutral',
        }
      }).filter((item) => item.label && item.context)
      : []

    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.slice(0, 5).map((item) => {
        const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        const priority = asString(row.priority, 'Medium')
        return {
          owner: asString(row.owner, 'Manager'),
          action: asString(row.action),
          priority: ['High', 'Medium', 'Low'].includes(priority) ? priority as AiAction['priority'] : 'Medium',
        }
      }).filter((item) => item.action)
      : []

    const summary = {
      title: asString(parsed.title, 'AI Business Summary'),
      executiveRead: asString(parsed.executiveRead),
      metricSignals,
      keyFindings: asStringList(parsed.keyFindings, 7),
      risks: asStringList(parsed.risks, 5),
      actions,
    }

    if (!summary.executiveRead && summary.metricSignals.length === 0 && summary.keyFindings.length === 0) {
      return null
    }

    return summary
  } catch {
    return null
  }
}

function buildSummaryText(summary: AiStructuredSummary) {
  return [
    summary.title,
    summary.executiveRead,
    ...summary.metricSignals.map((item) => `${item.label}: ${item.value} - ${item.context}`),
    ...summary.keyFindings,
    ...summary.risks,
    ...summary.actions.map((item) => `${item.priority || 'Medium'}: ${item.owner} - ${item.action}`),
  ].filter(Boolean).join('\n')
}

function createCacheKey(report: string, startDate: string, endDate: string, dataset: unknown) {
  return `kia:business-excellence:ai-summary:v2:${createHash('sha1')
    .update(JSON.stringify({ report, startDate, endDate, dataset }))
    .digest('hex')}`
}

export async function POST(request: NextRequest) {
  const accessError = await requireBrandApiAccess('kia')
  if (accessError) return accessError

  try {
    const body = await request.json() as SummaryRequest
    const report = String(body.report || '').trim()
    if (!SUPPORTED_REPORTS.has(report)) {
      return NextResponse.json({ error: 'Unsupported Business Excellence report' }, { status: 400 })
    }

    const { startDate, endDate } = getDateRange(body.dateFilter || null)
    const dataset = await buildReportDataset(request, report, startDate, endDate)
    const cacheKey = createCacheKey(report, startDate, endDate, dataset)
    const result = await getCachedData(
      cacheKey,
      async () => createAiSummary(report, startDate, endDate, dataset),
      CACHE_TTL_SECONDS
    )

    return NextResponse.json({
      ...result,
      report,
      dateRange: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    })
  } catch (error) {
    console.error('Failed to generate Business Excellence AI summary:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate AI summary'
    const status = message.includes('GROQ_API_KEY') ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
