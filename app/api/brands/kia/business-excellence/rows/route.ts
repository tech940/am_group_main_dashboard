import { NextResponse } from 'next/server'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_KEYS } from '@/lib/redis/client'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'

export const dynamic = 'force-dynamic'

export async function POST() {
  const accessError = await requireBrandSectionApiAccess('kia', 'kia.business_excellence.view')
  if (accessError) return accessError

  await invalidateCachePattern(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:*`)
  await invalidateCachePattern('kia:service-dashboard:*')

  return NextResponse.json(
    {
      error: 'Business Excellence rows are now managed through relational SQL tables and the cron/import pipeline. JSON row append is disabled.',
    },
    { status: 405 }
  )
}
