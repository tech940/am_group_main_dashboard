import { AsyncLocalStorage } from 'async_hooks'

type TimingEntry = {
  name: string
  durationMs: number
}

type SqlTimingEntry = {
  caller: string
  durationMs: number
  rowCount: number | null
  ok: boolean
}

type ApiTimingContext = {
  entries: SqlTimingEntry[]
  cacheStatus: string | null
}

const sqlTimingStorage = new AsyncLocalStorage<ApiTimingContext>()

export function recordSqlTiming(entry: SqlTimingEntry) {
  sqlTimingStorage.getStore()?.entries.push(entry)
}

export function getSqlTimingEntries() {
  return sqlTimingStorage.getStore()?.entries || []
}

export function recordCacheStatus(status: string) {
  const store = sqlTimingStorage.getStore()
  if (store) store.cacheStatus = status
}

function formatSqlTimingHeader(entries: SqlTimingEntry[]) {
  return entries
    .map((entry, index) => {
      const caller = entry.caller
        .replace(/[",]/g, '')
        .replace(/^\s+|\s+$/g, '')
        .slice(0, 140)
      const rowText = entry.rowCount === null ? '' : ` rows=${entry.rowCount}`
      return `q${index + 1} ${entry.ok ? 'ok' : 'error'} ${Math.round(entry.durationMs)}ms${rowText} ${caller}`
    })
    .join(' | ')
    .slice(0, 7000)
}

export function createApiTimer(label: string) {
  sqlTimingStorage.enterWith({ entries: [], cacheStatus: null })
  const startedAt = performance.now()
  const entries: TimingEntry[] = []

  async function time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const stepStartedAt = performance.now()
    try {
      return await work()
    } finally {
      entries.push({
        name,
        durationMs: performance.now() - stepStartedAt,
      })
    }
  }

  function finish() {
    const totalMs = performance.now() - startedAt
    const sqlEntries = getSqlTimingEntries()
    const detail = entries
      .map((entry) => `${entry.name}=${Math.round(entry.durationMs)}ms`)
      .join(' ')
    const sqlDetail = sqlEntries.length
      ? ` sql=[${sqlEntries.map((entry, index) => `q${index + 1}:${Math.round(entry.durationMs)}ms${entry.rowCount === null ? '' : `/${entry.rowCount}r`}`).join(' ')}]`
      : ''

    if (process.env.NODE_ENV !== 'production' || totalMs > 1000) {
      console.info(`[api:${label}] total=${Math.round(totalMs)}ms${detail ? ` ${detail}` : ''}${sqlDetail}`)
    }

    return {
      totalMs,
      sqlTimings: sqlEntries,
      cacheStatus: sqlTimingStorage.getStore()?.cacheStatus || 'BYPASS',
      sqlTimingHeader: formatSqlTimingHeader(sqlEntries),
      serverTiming: [
        `total;dur=${Math.round(totalMs)}`,
        ...entries.map((entry) => `${entry.name};dur=${Math.round(entry.durationMs)}`),
        ...sqlEntries.map((entry, index) => `sql_q${index + 1};dur=${Math.round(entry.durationMs)}`),
      ].join(', '),
    }
  }

  return { time, finish }
}

export function withServerTiming<T extends Response>(response: T, serverTiming: string) {
  response.headers.set('Server-Timing', serverTiming)
  const sqlEntries = getSqlTimingEntries()
  const sqlTimingHeader = formatSqlTimingHeader(sqlEntries)
  if (sqlTimingHeader) {
    response.headers.set('X-SQL-Timings', sqlTimingHeader)
  }
  response.headers.set('X-SQL-Query-Count', String(sqlEntries.length))
  response.headers.set('X-Cache-Status', sqlTimingStorage.getStore()?.cacheStatus || 'BYPASS')
  return response
}

export function withApiDiagnostics<T extends Response>(
  response: T,
  serverTiming: string,
  payload?: unknown
) {
  withServerTiming(response, serverTiming)
  if (payload !== undefined) {
    try {
      response.headers.set('X-Response-Bytes', String(Buffer.byteLength(JSON.stringify(payload))))
    } catch {
      response.headers.set('X-Response-Bytes', 'unknown')
    }
  }
  return response
}
