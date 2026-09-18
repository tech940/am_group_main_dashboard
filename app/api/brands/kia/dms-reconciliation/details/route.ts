import { NextResponse } from 'next/server'
import { requireDmsReconApi } from '@/lib/kia/dms-reconciliation/access'
import { getReconDetails } from '@/lib/kia/dms-reconciliation/read'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Every record on a list page in full, in one request — the tab fetches this as soon as a page of the
 * list arrives, so opening any row's detail is instant instead of a spinner. Same guard and the same
 * branch scoping as the single-record route; ids outside the viewer's branches are simply absent.
 */
export async function GET(request: Request) {
  const auth = await requireDmsReconApi()
  if ('response' in auth) return auth.response
  try {
    const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100)
    return NextResponse.json({ details: await getReconDetails(ids, auth.viewer) })
  } catch (error) {
    console.error('[kia-dms-recon] details failed:', error)
    return NextResponse.json({ error: 'Could not load these records.' }, { status: 500 })
  }
}
