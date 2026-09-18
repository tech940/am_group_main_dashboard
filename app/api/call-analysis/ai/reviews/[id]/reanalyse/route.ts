import { NextResponse } from 'next/server'
import { isCallAiAdmin, requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { requeueReview } from '@/lib/call-ai/read'

export const dynamic = 'force-dynamic'

/**
 * Put one call back on the AI queue (MD / developer). By default the saved transcript is re-read by the model;
 * `{ "retranscribe": true }` also re-runs speech to text. The next worker run (≤10 min) picks it up.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied
  if (!isCallAiAdmin(access.appUser.role)) {
    return NextResponse.json({ error: 'Only the MD or a developer can re-run the AI review.' }, { status: 403 })
  }
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  try {
    const ok = await requeueReview(id, Boolean((body as { retranscribe?: unknown })?.retranscribe))
    if (!ok) return NextResponse.json({ error: 'That call is being reviewed right now — try again in a few minutes.' }, { status: 409 })
    return NextResponse.json({ ok: true }, { status: 202 })
  } catch (error) {
    console.error('[call-ai] reanalyse failed:', error)
    return NextResponse.json({ error: 'Could not queue the call.' }, { status: 500 })
  }
}
