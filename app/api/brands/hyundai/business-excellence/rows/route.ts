import { NextResponse } from 'next/server'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'

export const dynamic = 'force-dynamic'
const HYUNDAI_BE_CACHE_PREFIX = 'hyundai:business-excellence'

export async function POST() {
  const accessError = await requireBrandSectionApiAccess('hyundai', 'hyundai.business_excellence.view')
  if (accessError) return accessError

  await Promise.all([
    invalidateCachePattern(`${HYUNDAI_BE_CACHE_PREFIX}:*`),
    invalidateCachePattern('hyundai:service-dashboard:*'),
  ])

  return NextResponse.json(
    {
      error: 'Business Excellence rows are now managed through relational SQL tables and the cron/import pipeline. JSON row append is disabled.',
    },
    { status: 405 }
  )
}
