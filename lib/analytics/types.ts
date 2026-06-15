export type AnalyticsReadSource = 'postgres' | 'dual' | 'bigquery'

export type AnalyticsQueryResult = {
  rows: Record<string, unknown>[]
  rowCount: number
}

export type AnalyticsProvider = {
  readonly source: AnalyticsReadSource
  execute: (query: unknown) => Promise<AnalyticsQueryResult>
  tableExists: (tableName: string) => Promise<boolean>
}

export type DualWriteBatchMeta = {
  batchId: string
  sourceTable: string
  destinationTable: string
  rowCount: number
  watermarkUploadedAt: string | null
  startedAt: string
  finishedAt: string
  status: 'success' | 'failed' | 'partial'
  errorMessage?: string | null
}
