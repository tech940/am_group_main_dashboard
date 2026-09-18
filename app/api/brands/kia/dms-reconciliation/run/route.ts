import { NextResponse } from 'next/server'
import { requireDmsReconApi } from '@/lib/kia/dms-reconciliation/access'
import { runKiaDmsReconciliation } from '@/lib/kia/dms-reconciliation/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Re-check now. Rebuilds the reconciliation from the live feeds and waits for it. Harmless to repeat:
 * it only rewrites the derived table, never a booking or a DMS feed, and a second click while a run is
 * in progress is answered with `running` instead of starting another.
 */
export async function POST() {
  const auth = await requireDmsReconApi()
  if ('response' in auth) return auth.response
  try {
    const result = await runKiaDmsReconciliation()
    if (!result.ran) return NextResponse.json({ ok: true, ran: false, reason: result.reason })
    return NextResponse.json({ ok: true, ran: true, ms: result.ms, opened: result.opened, resolved: result.resolved })
  } catch (error) {
    console.error('[kia-dms-recon] re-check failed:', error)
    return NextResponse.json({ error: 'The re-check failed. Try again in a minute.' }, { status: 500 })
  }
}
