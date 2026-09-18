import { NextResponse } from 'next/server'
import { isCallAiAdmin, requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { runCallAi } from '@/lib/call-ai/worker'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * AI Call Review worker: find new AM Hyundai recordings, transcribe them, write the verdicts.
 * Registered as a Vercel cron every 10 minutes (vercel.json). Each run stops ~60 s before maxDuration so a job
 * is never cut off half-written; anything left waits for the next run.
 *
 * Ways in (the shared fail-closed gate, then a session):
 *   - Vercel Cron:  `Authorization: Bearer $CRON_SECRET`
 *   - manual run:   `?secret=$CALL_AI_RUN_SECRET`
 *   - a signed-in MD or developer — running the pipeline spends money, so section access alone is not enough.
 */
async function handle(request: Request) {
  const started = Date.now()
  const url = new URL(request.url)
  const cronAuth = authorizeCronRequest(request, url, { secret: process.env.CALL_AI_RUN_SECRET, secretEnvName: 'CALL_AI_RUN_SECRET' })
  if (!cronAuth.ok) {
    const access = await requireCallAnalysisApi()
    if ('denied' in access) return access.denied
    if (!isCallAiAdmin(access.appUser.role)) {
      return NextResponse.json({ error: 'Only the MD or a developer can run the AI review.' }, { status: 403 })
    }
  }

  try {
    const stats = await runCallAi({ deadlineMs: started + 240_000 })
    return NextResponse.json({ ok: true, ...stats })
  } catch (error) {
    console.error('[call-ai] run failed:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Run failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
