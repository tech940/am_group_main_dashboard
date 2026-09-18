import { NextResponse } from 'next/server'
import { isCallAiAdmin, requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { sendDailyDigest } from '@/lib/call-ai/digest'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The 9 AM "yesterday's calls" email (cron `30 3 * * *` = 09:00 IST).
 *
 *   - Cron (`Bearer $CRON_SECRET` or `?secret=$CALL_AI_DIGEST_SECRET`): sends to CALL_AI_DIGEST_RECIPIENTS,
 *     once per day. No recipients configured → nothing is sent.
 *   - A signed-in MD or developer: `?dryRun=1[&date=YYYY-MM-DD]` returns the email as HTML to look at, and
 *     never sends. A session can only ever preview.
 */
async function handle(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get('date') || undefined
  const cronAuth = authorizeCronRequest(request, url, { secret: process.env.CALL_AI_DIGEST_SECRET, secretEnvName: 'CALL_AI_DIGEST_SECRET' })

  try {
    if (cronAuth.ok) {
      const result = await sendDailyDigest({ date, request })
      return NextResponse.json({ ok: result.status !== 'failed', ...result })
    }
    const access = await requireCallAnalysisApi()
    if ('denied' in access) return access.denied
    if (!isCallAiAdmin(access.appUser.role)) {
      return NextResponse.json({ error: 'Only the MD or a developer can preview the digest.' }, { status: 403 })
    }
    const preview = await sendDailyDigest({ date, request, dryRun: true })
    if (preview.status !== 'dry_run') return NextResponse.json(preview)
    return new NextResponse(preview.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[call-ai] digest failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Digest failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
