import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import { runCallyzerSync } from '@/lib/callyzer/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // a cold backfill pages ~1.9k calls at ~2.7s/page

/**
 * Pulls new calls from Callyzer into Postgres. THIS is what keeps the section alive — nothing else
 * writes callyzer_calls, so if this stops running the whole page silently freezes on stale data.
 * It is registered as a Vercel cron in vercel.json (every 3 hours); the npm scheduler is a local aid.
 * The cadence is safe to change: the delta window starts from the newest synced_at we already hold,
 * not from wall-clock, so a longer gap just means one slightly larger page — never a missed call.
 *
 * Three ways in, via the shared fail-closed gate:
 *   - Vercel Cron / scheduler: `Authorization: Bearer $CRON_SECRET`
 *   - manual / npm runner:     `?secret=$CALLYZER_SYNC_SECRET`
 *   - a signed-in MD/Developer pressing "Sync now"
 *
 * ?mode=backfill re-walks the last 180 days; default is an incremental delta from the newest
 * synced_at we hold.
 */
async function handle(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') === 'backfill' ? 'backfill' : 'delta'

  // Machine callers first. authorizeCronRequest fails closed: an unconfigured secret refuses to run
  // rather than opening the endpoint. A human session is the fallback, so a missing cron secret
  // never blocks the "Sync now" button.
  const cronAuth = authorizeCronRequest(request, url, {
    secret: process.env.CALLYZER_SYNC_SECRET,
    secretEnvName: 'CALLYZER_SYNC_SECRET',
  })

  if (!cronAuth.ok) {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canViewCallAnalysis(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const result = await runCallyzerSync(mode)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Callyzer sync failed:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    )
  }
}

export const GET = handle
export const POST = handle
