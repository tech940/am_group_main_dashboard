import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export async function generateFuelRequestNumber(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const datePrefix = `KIA-FUEL-${year}${month}${day}`

  // Find count of records created today
  const result = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(fuelApprovals)
    .where(sql`${fuelApprovals.requestNumber} LIKE ${datePrefix + '-%'}`)

  const nextSeq = ((result[0]?.count ?? 0) + 1).toString().padStart(4, '0')
  return `${datePrefix}-${nextSeq}`
}
