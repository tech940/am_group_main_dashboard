import { getAnalyticsEnv } from './config'
import { createBigQueryAnalyticsProvider } from './bigquery-provider'
import { createDualAnalyticsProvider } from './dual-provider'
import { createPostgresAnalyticsProvider } from './postgres-provider'
import type { AnalyticsProvider } from './types'

let cachedProvider: AnalyticsProvider | null = null

export function getAnalyticsProvider(): AnalyticsProvider {
  if (cachedProvider) return cachedProvider

  const { readSource } = getAnalyticsEnv()
  if (readSource === 'bigquery') {
    cachedProvider = createBigQueryAnalyticsProvider()
  } else if (readSource === 'dual') {
    cachedProvider = createDualAnalyticsProvider({
      onMismatch: (details) => {
        console.warn('[analytics:dual] mismatch', details)
      },
    })
  } else {
    cachedProvider = createPostgresAnalyticsProvider()
  }

  return cachedProvider
}

export function resetAnalyticsProviderForTests() {
  cachedProvider = null
}

export type { AnalyticsProvider, AnalyticsQueryResult, AnalyticsReadSource } from './types'
export { getAnalyticsEnv, isBigQueryReadsEnabled } from './config'
export { POSTGRES_TO_BIGQUERY_TABLE, SYNC_TABLE_ORDER, resolveBigQueryTable } from './table-map'
export { rewritePostgresTablesToBigQuery } from './bigquery-provider'
