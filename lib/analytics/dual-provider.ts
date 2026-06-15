import { createBigQueryAnalyticsProvider, extractSqlText } from './bigquery-provider'
import { createPostgresAnalyticsProvider } from './postgres-provider'
import type { AnalyticsProvider, AnalyticsQueryResult } from './types'

function summarizeDiff(pg: AnalyticsQueryResult, bq: AnalyticsQueryResult) {
  return {
    postgresRowCount: pg.rowCount,
    bigqueryRowCount: bq.rowCount,
    rowCountDelta: pg.rowCount - bq.rowCount,
  }
}

export function createDualAnalyticsProvider(options?: {
  onMismatch?: (details: Record<string, unknown>) => void
}): AnalyticsProvider {
  const postgres = createPostgresAnalyticsProvider()
  const bigquery = createBigQueryAnalyticsProvider()

  return {
    source: 'dual',
    async execute(query) {
      const [pg, bq] = await Promise.allSettled([
        postgres.execute(query),
        bigquery.execute(query),
      ])

      if (pg.status === 'rejected') throw pg.reason
      const pgResult = pg.value

      if (bq.status === 'fulfilled') {
        const diff = summarizeDiff(pgResult, bq.value)
        if (diff.rowCountDelta !== 0) {
          options?.onMismatch?.({
            mode: 'dual',
            sql: extractSqlText(query).slice(0, 500),
            ...diff,
          })
        }
      } else {
        options?.onMismatch?.({
          mode: 'dual',
          sql: extractSqlText(query).slice(0, 500),
          bigqueryError: bq.reason instanceof Error ? bq.reason.message : String(bq.reason),
        })
      }

      return pgResult
    },
    async tableExists(tableName) {
      const [pg, bq] = await Promise.all([
        postgres.tableExists(tableName),
        bigquery.tableExists(tableName).catch(() => false),
      ])
      return pg || bq
    },
  }
}
