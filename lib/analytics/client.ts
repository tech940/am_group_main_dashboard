import type { BigQuery } from '@google-cloud/bigquery'
import { getAnalyticsEnv } from './config'

let client: BigQuery | null = null

export async function getBigQueryClient(): Promise<BigQuery> {
  if (client) return client

  const { BigQuery: BigQueryCtor } = await import('@google-cloud/bigquery')
  const env = getAnalyticsEnv()
  client = new BigQueryCtor({
    projectId: env.gcpProjectId || undefined,
    location: env.bigQueryLocation,
  })
  return client
}

export function resetBigQueryClientForTests() {
  client = null
}
