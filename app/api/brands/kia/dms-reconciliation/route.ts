import { after, NextResponse } from 'next/server'
import { requireDmsReconApi } from '@/lib/kia/dms-reconciliation/access'
import { countOpenRecon, listReconItems, parseReconFilters, readReconFreshness } from '@/lib/kia/dms-reconciliation/read'
import { runKiaDmsReconciliation } from '@/lib/kia/dms-reconciliation/run'

export const dynamic = 'force-dynamic'
// The stale-result refresh runs in after(), inside this route's duration.
export const maxDuration = 60

/**
 * The DMS Exceptions list + summary for one month. Serves the STORED reconciliation immediately; if an
 * input has moved since it was built (a DMS upload, a booking change), the rebuild is scheduled after
 * the response and the client polls while `freshness.refreshing` is true. A page load never waits on
 * the several-second rebuild.
 */
export async function GET(request: Request) {
  const auth = await requireDmsReconApi()
  if ('response' in auth) return auth.response
  try {
    const params = new URL(request.url).searchParams
    // The Bookings tab badge: one indexed count, no freshness check, no refresh.
    if (params.get('countOnly') === '1') {
      return NextResponse.json({ openCount: await countOpenRecon(auth.viewer) })
    }
    const filters = parseReconFilters(params)
    const [{ freshness, stale }, data] = await Promise.all([readReconFreshness(), listReconItems(filters, auth.viewer)])
    if (stale && !freshness.refreshing) {
      after(() => runKiaDmsReconciliation({ onlyIfStale: true }).catch((error) => console.error('[kia-dms-recon] refresh failed:', error)))
      freshness.refreshing = true
    }
    return NextResponse.json({ ...data, freshness })
  } catch (error) {
    console.error('[kia-dms-recon] list failed:', error)
    return NextResponse.json({ error: 'Could not load DMS exceptions.' }, { status: 500 })
  }
}
