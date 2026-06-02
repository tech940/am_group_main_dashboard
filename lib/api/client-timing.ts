'use client'

export type ApiTimingEntry = {
  id: string
  label: string
  url: string
  status: number
  ok: boolean
  totalMs: number | null
  responseStep: string
  responseStepMs: number | null
  sqlCount: number
  sqlMs: number
  slowestSqlMs: number
  rowCount: number
  source: 'db' | 'cache' | 'mixed' | 'unknown'
  recordedAt: string
  serverTiming: string
  sqlTimings: string
}

export const API_TIMING_EVENT = 'dashboard-api-timing'

function parseServerTiming(header: string | null) {
  const entries = new Map<string, number>()
  if (!header) return entries

  header.split(',').forEach((part) => {
    const [rawName, ...params] = part.trim().split(';')
    const name = rawName?.trim()
    if (!name) return

    const durationParam = params.find((param) => param.trim().startsWith('dur='))
    const duration = Number(durationParam?.split('=')[1])
    entries.set(name, Number.isFinite(duration) ? duration : 0)
  })

  return entries
}

function parseSqlTiming(header: string | null) {
  if (!header) {
    return { count: 0, totalMs: 0, slowestMs: 0, rowCount: 0 }
  }

  const queries = header.split('|').map((item) => item.trim()).filter(Boolean)
  const durations = queries.map((query) => {
    const match = query.match(/\b(\d+)ms\b/)
    return match ? Number(match[1]) : 0
  })
  const rowCount = queries.reduce((sum, query) => {
    const match = query.match(/\brows=(\d+)\b/)
    return sum + (match ? Number(match[1]) : 0)
  }, 0)

  return {
    count: queries.length,
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    slowestMs: durations.length ? Math.max(...durations) : 0,
    rowCount,
  }
}

function resolveSource(serverEntries: Map<string, number>, sqlCount: number): ApiTimingEntry['source'] {
  if (serverEntries.has('response-cache') && sqlCount === 0) return 'cache'
  if (serverEntries.has('response-cache') && sqlCount > 0) return 'mixed'
  if (serverEntries.has('db') || sqlCount > 0) return 'db'
  return 'unknown'
}

export function logApiTimings(response: Response, label: string) {
  const sqlTimings = response.headers.get('x-sql-timings') || ''
  const serverTiming = response.headers.get('server-timing') || ''
  const serverEntries = parseServerTiming(serverTiming)
  const sql = parseSqlTiming(sqlTimings)
  const totalMs = serverEntries.get('total') ?? null
  const responseStep = Array.from(serverEntries.keys()).find((name) => name !== 'total' && !name.startsWith('sql_q')) || 'response'
  const responseStepMs = serverEntries.get(responseStep) ?? null

  const entry: ApiTimingEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    url: response.url,
    status: response.status,
    ok: response.ok,
    totalMs,
    responseStep,
    responseStepMs,
    sqlCount: sql.count,
    sqlMs: sql.totalMs,
    slowestSqlMs: sql.slowestMs,
    rowCount: sql.rowCount,
    source: resolveSource(serverEntries, sql.count),
    recordedAt: new Date().toISOString(),
    serverTiming,
    sqlTimings,
  }

  if (sqlTimings) {
    console.log(`[sql-timings:${label}]`, sqlTimings)
  } else if (serverTiming) {
    console.log(`[server-timing:${label}]`, serverTiming)
  }

  if (typeof window !== 'undefined' && serverTiming) {
    window.dispatchEvent(new CustomEvent<ApiTimingEntry>(API_TIMING_EVENT, { detail: entry }))
  }
}
