import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { AnalyticsProvider, AnalyticsQueryResult } from './types'

function normalizeRows(result: unknown): AnalyticsQueryResult {
  if (Array.isArray(result)) {
    return { rows: result as Record<string, unknown>[], rowCount: result.length }
  }
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: Record<string, unknown>[] }).rows
      : []
    const rowCount = 'rowCount' in result
      ? Number((result as { rowCount?: unknown }).rowCount) || rows.length
      : rows.length
    return { rows, rowCount }
  }
  return { rows: [], rowCount: 0 }
}

export function createPostgresAnalyticsProvider(): AnalyticsProvider {
  return {
    source: 'postgres',
    async execute(query) {
      const result = await db.execute(query as Parameters<typeof db.execute>[0])
      return normalizeRows(result)
    },
    async tableExists(tableName) {
      const result = await db.execute(sql`
        SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists
      `)
      const rows = normalizeRows(result).rows
      return Boolean(rows[0]?.exists)
    },
  }
}
