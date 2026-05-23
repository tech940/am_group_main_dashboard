import { NextResponse } from 'next/server'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_KEYS } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'

export const dynamic = 'force-dynamic'

export async function POST() {
  const accessError = await requireBrandApiAccess('kia')
  if (accessError) return accessError

  await invalidateCachePattern(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:*`)
  await invalidateCachePattern('ro_billing:*')

  return NextResponse.json(
    {
      error: 'Business Excellence rows are now managed through relational SQL tables and the cron/import pipeline. JSON row append is disabled.',
    },
    { status: 405 }
  )
}
