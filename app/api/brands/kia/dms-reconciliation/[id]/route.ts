import { NextResponse } from 'next/server'
import { requireDmsReconApi } from '@/lib/kia/dms-reconciliation/access'
import { getReconDetail } from '@/lib/kia/dms-reconciliation/read'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** One exception in full: our booking, the DMS booking, its status history, sales rows and receipts. */
export async function GET(_request: Request, context: RouteContext<'/api/brands/kia/dms-reconciliation/[id]'>) {
  const auth = await requireDmsReconApi()
  if ('response' in auth) return auth.response
  try {
    const { id } = await context.params
    const detail = await getReconDetail(id, auth.viewer)
    // Out of the viewer's branch reads as not found — no hint that the record exists.
    if (!detail) return NextResponse.json({ error: 'Record not found.' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    console.error('[kia-dms-recon] detail failed:', error)
    return NextResponse.json({ error: 'Could not load this record.' }, { status: 500 })
  }
}
