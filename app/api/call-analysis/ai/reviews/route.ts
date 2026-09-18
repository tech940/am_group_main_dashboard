import { NextResponse } from 'next/server'
import { requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { supabaseCreSource } from '@/lib/call-ai/cre-source'
import { attachCustomers, listReviews, parseReviewFilters } from '@/lib/call-ai/read'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** AI Call Review list: one page of verdicts + the digest counts for the chosen days (one DB statement). */
export async function GET(request: Request) {
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied
  try {
    const filters = parseReviewFilters(new URL(request.url).searchParams)
    const result = await listReviews(filters)
    const rows = await attachCustomers(result.rows, supabaseCreSource())
    return NextResponse.json({ ...result, rows }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[call-ai] list failed:', error)
    return NextResponse.json({ error: 'Could not load the AI call review.' }, { status: 500 })
  }
}
