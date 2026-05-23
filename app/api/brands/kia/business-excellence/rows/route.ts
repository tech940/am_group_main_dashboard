import { NextResponse } from 'next/server'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_KEYS } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'

export async function POST() {
  await invalidateCachePattern(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:*`)
  await invalidateCachePattern('ro_billing:*')

  return NextResponse.json(
    {
      error: 'Business Excellence rows are now managed through relational SQL tables and the cron/import pipeline. JSON row append is disabled.',
    },
    { status: 405 }
  )
}
