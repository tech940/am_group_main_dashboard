import { NextResponse } from 'next/server'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'

export const dynamic = 'force-dynamic'
const HYUNDAI_BE_CACHE_PREFIX = 'hyundai:business-excellence'

export async function POST() {
  const accessError = await requireBrandApiAccess('hyundai')
  if (accessError) return accessError

  await invalidateCachePattern(`${HYUNDAI_BE_CACHE_PREFIX}:*`)

  return NextResponse.json(
    {
      error: 'Business Excellence rows are now managed through relational SQL tables and the cron/import pipeline. JSON row append is disabled.',
    },
    { status: 405 }
  )
}
