import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/maintenance/cron-auth'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { isLoconavRateLimited } from '@/lib/loconav/client'
import { getLoconavSyncState, recordTripSweepFailure, runLoconavSync } from '@/lib/loconav/sync'
import { runTripReconciliation } from '@/lib/loconav/trips'

export const dynamic = 'force-dynamic'
/**
 * Paging the provider fleet plus a chunked position poll. Sized well above the expected cost so a
 * slow provider fails as a timeout we can see, not a truncated sync that looks like it worked.
 */
export const maxDuration = 120

/**
 * A manual "Sync now" this soon after the last run is refused with 429.
 *
 * ⚠️ The account allows 20 LocoNav requests per window, and one run spends the listing, the position
 * poll and then trip history from that same allowance. A double-clicked button, or a second approver
 * pressing it a moment after the first, must not spend what the next cron run needs.
 */
const MANUAL_SYNC_COOLDOWN_SECONDS = 60

/**
 * Pull LocoNav vehicle identities and last-known positions into Postgres.
 *
 * ⚠️ NOTHING ELSE IN THE APP CALLS LOCONAV. Every read surface serves from the tables this writes —
 * see lib/loconav/positions.ts. A page render must never wait on a third-party fleet API.
 *
 * Auth, in order:
 *   1. the cron credential (authorizeCronRequest — FAILS CLOSED with 503 when unconfigured), then
 *   2. a signed-in gate pass approver, so a missing cron secret never blocks a manual "Sync now".
 * That order is copied from app/api/call-analysis/sync/route.ts, which documents the same reason.
 *
 * Both GET and POST: Vercel Cron issues GET, the npm runners and curl use POST.
 */
async function run(request: NextRequest) {
  // Taken at entry, not inside the sweep — runLoconavSync spends an unknown slice of it first.
  const startedAt = Date.now()
  const cron = authorizeCronRequest(request, request.nextUrl, {
    secret: process.env.LOCONAV_SYNC_SECRET,
    secretEnvName: 'LOCONAV_SYNC_SECRET',
  })

  if (!cron.ok) {
    /*
     * ⚠️ 'gate_pass.approve', not 'gate_pass.view'. requireGatePassAccess lets EVERY authenticated
     * employee through for view/create by design (access.ts:120-123), so gating a write-and-egress
     * job on view would make it callable by the whole company.
     */
    const access = await requireGatePassAccess('gate_pass.approve')
    if (access.denied) return NextResponse.json({ error: cron.error }, { status: cron.status })

    /*
     * ⚠️ MANUAL CALLS ONLY. A cron-authorised call never reaches this branch, so the schedule the
     * cooldown exists to protect can never be refused by it.
     *
     * Read defensively: getLoconavSyncState answers all-null when 0057 is not applied, and a read that
     * fails outright means no cooldown — the sync itself then records what is wrong. An unconfigured
     * run spends no requests, so it is not spaced out.
     *
     * ⚠️ last_run_at is stamped when the POSITION POLL finishes, not when the request does: the trip sweep after
     * it runs for up to ~100 s from the request's start without touching sync state. So this spaces a manual run
     * from the last poll, not from the end of the previous request, and two presses that start together still
     * overlap — the panel's shared pending state stops that within one browser only, not across tabs, approvers
     * or the cron. An overrun is made safe, not prevented: a 429 is typed and never retried, a deferred trip pass
     * spends no attempt, and a failed run records the rate-limit sentence.
     */
    const state = await getLoconavSyncState().catch((error) => {
      console.warn('[loconav] sync state unreadable; manual cooldown skipped:', error)
      return null
    })
    if (state?.configured && state.lastRunAt) {
      const secondsAgo = Math.max(0, Math.floor((Date.now() - new Date(state.lastRunAt).getTime()) / 1000))
      if (secondsAgo < MANUAL_SYNC_COOLDOWN_SECONDS) {
        // After a failed run, "synced" would contradict the panel's own "The last sync failed" line.
        const last = state.lastRunStatus === 'failed' ? 'The last sync attempt failed' : 'Tracking synced'
        return NextResponse.json(
          { error: `${last} ${secondsAgo} seconds ago. Try again in a minute.` },
          { status: 429 },
        )
      }
    }
  }

  try {
    const result = await runLoconavSync()
    if (!result.configured) {
      /*
       * 200, not an error. "Tracking is not switched on" is a configuration fact the caller should
       * be able to read without treating it as a fault — a cron that 500s nightly on a feature
       * nobody has enabled yet is noise that trains people to ignore the alert.
       */
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'LOCO_AUTH_TOKEN is not configured.',
        ...result,
      })
    }
    /*
     * Reconcile finished drives after the positions land.
     *
     * ⚠️ AFTER, and never instead. Live position is the time-critical half — a car that is out right
     * now is the thing somebody is looking for — so it must not be delayed or skipped by a backfill
     * of trips that finished days ago.
     *
     * ⚠️ Its failure is caught here rather than allowed to propagate: the positions have already been
     * written and committed at this point, and reporting the whole sync as a 502 would make an
     * operator believe live tracking is down when only the historical sweep stumbled. Bounded to
     * TRIP_BATCH_SIZE passes per run so it cannot eat the request budget.
     */
    let trips: Awaited<ReturnType<typeof runTripReconciliation>> | { error: string }
    try {
      /*
       * ⚠️ 100s of the 120s budget, measured from when the REQUEST started. The sweep stops before
       * beginning a pass it cannot finish, so the response always arrives and the cron records a
       * success instead of a timeout that reads as "live tracking is down".
       */
      trips = await runTripReconciliation(new Date(), { deadlineMs: startedAt + 100_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('LocoNav trip reconciliation failed:', message)
      trips = { error: 'Trip reconciliation failed — positions were still updated.' }
      /*
       * ⚠️ Into the sync state too. runLoconavSync has already recorded 'ok', and neither runner reads this body,
       * so a sweep that threw on every run was recorded nowhere — every returned pass read "Not checked" for good.
       * Bookkeeping only: it may not turn this 200 into a 502.
       */
      await recordTripSweepFailure().catch((e) => console.error('[loconav] could not record the trip sweep failure:', e))
    }

    /*
     * ⚠️ `errors` already carries only classified text (see classifyProviderFailure), but the pass
     * numbers are the useful part for an operator and the provider's words are never wanted here.
     */
    return NextResponse.json({ ok: true, ...result, trips })
  } catch (error) {
    console.error('LocoNav sync failed:', error)
    // The provider's own message is logged server-side but never returned — it can carry account
    // detail, and the sync-state row already records it for an operator.
    /*
     * A rate limit gets its own fixed sentence: it is not a fault, and "sync failed" would send the
     * person who pressed Sync now looking for one. Still 502 — the sync did not happen.
     */
    return NextResponse.json(
      {
        error: isLoconavRateLimited(error)
          ? 'LocoNav rate limit reached. Try again in a few minutes.'
          : 'LocoNav sync failed.',
      },
      { status: 502 },
    )
  }
}

export const GET = run
export const POST = run
