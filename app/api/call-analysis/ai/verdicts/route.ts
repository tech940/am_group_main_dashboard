import { NextResponse } from 'next/server'
import { requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { lookupVerdicts } from '@/lib/call-ai/read'

export const dynamic = 'force-dynamic'

/** Verdict chips for one page of the Recordings tab: `?ids=<recording id>,…` (≤100). One statement. */
export async function GET(request: Request) {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied
  const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
  try {
    return NextResponse.json({ verdicts: await lookupVerdicts(ids) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[call-ai] verdict lookup failed:', error)
    return NextResponse.json({ error: 'Could not load AI verdicts.' }, { status: 500 })
  }
}
