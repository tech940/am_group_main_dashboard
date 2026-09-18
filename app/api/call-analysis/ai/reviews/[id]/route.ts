import { NextResponse } from 'next/server'
import { requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { supabaseCreSource } from '@/lib/call-ai/cre-source'
import { attachCustomers, getReview } from '@/lib/call-ai/read'

export const dynamic = 'force-dynamic'

/** One review: the verdict, the full analysis, the transcript and the MD's corrections. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const review = await getReview(id)
    if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [named] = await attachCustomers([review], supabaseCreSource())
    return NextResponse.json(named, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[call-ai] detail failed:', error)
    return NextResponse.json({ error: 'Could not load this call review.' }, { status: 500 })
  }
}
