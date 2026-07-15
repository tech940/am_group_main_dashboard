import { NextResponse } from 'next/server'
import { AUTO_DEACTIVATION_IDLE_DAYS, runAutoDeactivationSweep } from '@/lib/auth/user-deactivation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron endpoint: deactivates users who have not used the app for AUTO_DEACTIVATION_IDLE_DAYS.
 * Exempt roles (md / ea / accounts / developer) are never touched. Idempotent — safe to re-run.
 *
 * Two callers, two auth styles:
 *  - GET  + `Authorization: Bearer $CRON_SECRET`  → Vercel Cron (see vercel.json). Vercel Cron only
 *    ever issues GET, so a POST-only route would never fire.
 *  - POST + `?secret=$USER_DEACTIVATION_SECRET`   → npm run users:deactivate-idle, n8n, manual curl.
 *
 * For a Vercel-Cron-only setup you need CRON_SECRET alone; USER_DEACTIVATION_SECRET is optional and
 * exists for manual runs.
 *
 * Params: ?dryRun=1 reports who WOULD be deactivated without writing.
 *         ?force=1 overrides the mass-lockout circuit breaker (see lib/auth/user-deactivation.ts).
 */

type AuthResult = { ok: true } | { ok: false; status: number; error: string }

function authorize(request: Request, url: URL): AuthResult {
  const cronSecret = process.env.CRON_SECRET
  const manualSecret = process.env.USER_DEACTIVATION_SECRET

  // FAILS CLOSED. /api/brands/kia/maintenance is wide open when its secret is unset, which is
  // survivable for stock holds; an unauthenticated call to this one could lock every non-exempt
  // user out of the dashboard, so no secret means no run.
  if (!cronSecret && !manualSecret) {
    return {
      ok: false,
      status: 503,
      error: 'Neither CRON_SECRET nor USER_DEACTIVATION_SECRET is configured; refusing to run.',
    }
  }

  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return { ok: true }
  }
  if (manualSecret && url.searchParams.get('secret') === manualSecret) {
    return { ok: true }
  }

  return { ok: false, status: 403, error: 'Forbidden' }
}

async function handle(request: Request) {
  const url = new URL(request.url)

  const auth = authorize(request, url)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const dryRun = url.searchParams.get('dryRun') === '1'
  const force = url.searchParams.get('force') === '1'

  try {
    const result = await runAutoDeactivationSweep({ dryRun, force })
    return NextResponse.json(
      { ...result, idleDays: AUTO_DEACTIVATION_IDLE_DAYS },
      { status: result.ok ? 200 : 500 }
    )
  } catch (error) {
    console.error('Auto-deactivation sweep failed:', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Sweep failed' },
      { status: 500 }
    )
  }
}

export const GET = handle
export const POST = handle
