import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { listCommonCustomers } from '@/lib/customer-360/common-customers'
import { CUSTOMER_BRAND_LIST } from '@/lib/customer-360/brands'

// Three cross-brand joins over the full sales feeds. Cached for 15 minutes inside the reader.
export const maxDuration = 60

/**
 * CUSTOMER 360 — customers who have bought from more than one brand.
 *
 * Only brands the signed-in user may see are compared, so this cannot become a side door into a
 * brand they were not granted: a pair is matched only when BOTH sides are permitted.
 */
export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const granted = await requirePermission(appUser, 'customer_360.view')
  if (!granted.allowed) return NextResponse.json({ error: granted.reason }, { status: 403 })

  const brands = CUSTOMER_BRAND_LIST
    .filter((config) => canAccessBrand(appUser, config.brand))
    .map((config) => config.brand)

  try {
    return NextResponse.json(await listCommonCustomers(brands))
  } catch (error) {
    console.error('[customer-360/common] failed', error)
    return NextResponse.json({ error: 'Failed to load common customers' }, { status: 500 })
  }
}
