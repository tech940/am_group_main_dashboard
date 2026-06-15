import type { AnalyticsReadSource } from './types'

export type AnalyticsEnv = {
  readSource: AnalyticsReadSource
  gcpProjectId: string
  bigQueryLocation: string
  queryTimeoutMs: number
}

function parseReadSource(value: string | undefined): AnalyticsReadSource {
  if (value === 'bigquery' || value === 'dual') return value
  return 'postgres'
}

export function getAnalyticsEnv(): AnalyticsEnv {
  return {
    readSource: parseReadSource(process.env.ANALYTICS_READ_SOURCE),
    gcpProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '',
    bigQueryLocation: process.env.BIGQUERY_LOCATION || 'asia-south1',
    queryTimeoutMs: Number(process.env.ANALYTICS_QUERY_TIMEOUT_MS || 60_000),
  }
}

export function isBigQueryReadsEnabled() {
  const source = getAnalyticsEnv().readSource
  return source === 'bigquery' || source === 'dual'
}
