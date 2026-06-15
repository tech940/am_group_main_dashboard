import { getAnalyticsEnv } from './config'
import { getBigQueryClient } from './client'
import { POSTGRES_TO_BIGQUERY_TABLE } from './table-map'
import type { AnalyticsProvider, AnalyticsQueryResult } from './types'

function rowsFromBigQuery(result: unknown): AnalyticsQueryResult {
  const job = result as { rows?: Record<string, unknown>[]; totalRows?: string }
  const rows = Array.isArray(job?.rows) ? job.rows : []
  const rowCount = job?.totalRows ? Number(job.totalRows) : rows.length
  return { rows, rowCount }
}

/**
 * Rewrites known Postgres public table references to BigQuery FQNs.
 * Full SQL porting for dialect differences is handled per-module over time.
 */
export function rewritePostgresTablesToBigQuery(queryText: string, projectId: string) {
  let rewritten = queryText
  for (const [postgresName, bqPath] of Object.entries(POSTGRES_TO_BIGQUERY_TABLE)) {
    const pattern = new RegExp(`\\b${postgresName}\\b`, 'gi')
    rewritten = rewritten.replace(pattern, `\`${projectId}.${bqPath}\``)
  }
  return rewritten
}

export function createBigQueryAnalyticsProvider(): AnalyticsProvider {
  return {
    source: 'bigquery',
    async execute(query) {
      const env = getAnalyticsEnv()
      if (!env.gcpProjectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT is required when ANALYTICS_READ_SOURCE=bigquery')
      }

      const queryText = typeof query === 'string' ? query : extractSqlText(query)

      const bq = await getBigQueryClient()
      const [job] = await bq.createQueryJob({
        query: rewritePostgresTablesToBigQuery(queryText, env.gcpProjectId),
        location: env.bigQueryLocation,
        jobTimeoutMs: env.queryTimeoutMs,
      })
      const [rows] = await job.getQueryResults()
      return rowsFromBigQuery({ rows, totalRows: String(rows.length) })
    },
    async tableExists(tableName) {
      const env = getAnalyticsEnv()
      const mapped = POSTGRES_TO_BIGQUERY_TABLE[tableName]
      if (!mapped || !env.gcpProjectId) return false
      const bq = await getBigQueryClient()
      const [dataset, table] = mapped.split('.')
      const [tables] = await bq.dataset(dataset).getTables()
      return tables.some((item) => item.id === table)
    },
  }
}

/** Placeholder for future parameterized Drizzle→BigQuery execution. */
export function extractSqlText(query: unknown) {
  if (typeof query === 'string') return query
  if (query && typeof query === 'object') {
    const chunks = (query as { queryChunks?: Array<{ value?: string[] }> }).queryChunks
    if (Array.isArray(chunks)) {
      return chunks.map((chunk) => (chunk.value || []).join('')).join('')
    }
  }
  return String(query)
}
