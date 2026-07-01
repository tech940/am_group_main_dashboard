import 'server-only'

import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

type ExistsRow = {
  exists?: unknown
}

const readAnalyticsTableExists = unstable_cache(
  async (tableName: string) => {
    const normalized = tableName.trim()
    if (!normalized) return false

    const result = await db.execute(sql`
      SELECT to_regclass(${`public.${normalized}`}) IS NOT NULL AS exists
    `)

    if (!Array.isArray(result)) return false
    return Boolean((result[0] as ExistsRow | undefined)?.exists)
  },
  ['analytics-table-exists'],
  { revalidate: 60 * 60 }
)

export async function analyticsTableExists(tableName: string) {
  try {
    return await readAnalyticsTableExists(tableName)
  } catch (err: any) {
    if (err?.message?.includes('incrementalCache missing')) {
      const normalized = tableName.trim()
      if (!normalized) return false
      const result = await db.execute(sql`
        SELECT to_regclass(${`public.${normalized}`}) IS NOT NULL AS exists
      `)
      if (!Array.isArray(result)) return false
      return Boolean((result[0] as ExistsRow | undefined)?.exists)
    }
    throw err
  }
}
