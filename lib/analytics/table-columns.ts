import 'server-only'

import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

type ColumnRow = {
  column_name?: unknown
}

const readAnalyticsTableColumns = unstable_cache(
  async (tableName: string) => {
    const normalized = tableName.trim()
    if (!normalized) return [] as string[]

    const result = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${normalized}
      ORDER BY ordinal_position
    `)

    if (!Array.isArray(result)) return [] as string[]
    return result
      .map((row) => String((row as ColumnRow).column_name || '').trim())
      .filter(Boolean)
  },
  ['analytics-table-columns'],
  { revalidate: 60 * 60 }
)

export async function analyticsTableColumns(tableName: string) {
  return await readAnalyticsTableColumns(tableName)
}

export async function analyticsTableColumnSet(tableName: string) {
  return new Set(await analyticsTableColumns(tableName))
}

export async function analyticsTableHasColumn(tableName: string, columnName: string) {
  const columns = await analyticsTableColumnSet(tableName)
  return columns.has(columnName.trim())
}
