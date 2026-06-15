export type { DualWriteBatchMeta } from '@/lib/analytics/types'

export type DualWriteContract = {
  batchId: string
  sourceTable: string
  postgresTable: string
  bigQueryTable: string
  upsertKey: 'row_hash'
  watermarkColumn: 'uploaded_at'
  rowCount: number
  status: 'success' | 'failed' | 'partial'
}
