import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'
import {
  branchLabel,
  creRosterForBranches,
  distinctOnLatest,
  fetchAllPaged,
  loadCreDirectory,
  resolveBranchId,
  resolveBranchScope,
} from '@/lib/cre-calls/directory'

export const dynamic = 'force-dynamic'

/**
 * Fleet Health — the state of the CRE handsets that feed this whole section.
 *
 * Every other tab reports on calls that ARRIVED. This one answers the question those tabs cannot:
 * why is a CRE showing no calls at all? The answer is almost never "they made no calls" — it is that
 * the app was never installed on their handset, they are signed out of it, or Android is blocking
 * the permission the recorder needs.
 *
 * ── Sources ────────────────────────────────────────────────────────────────────────────────────
 *  - `device_sync_health` — the handset's own self-report. It is a TIME SERIES: one row per
 *    (user, device) per sweep. Reading it raw shows every heartbeat a phone ever sent, which makes a
 *    perfectly healthy fleet look like a wall of alarms. Current state is the LATEST row per device,
 *    i.e. `distinct on (user_id, device_id) order by last_heartbeat_at desc`.
 *
 *    ⚠️ PostgREST cannot express DISTINCT ON and this project exposes no RPC or view that does it
 *    (checked: no `latest_device_sync_health` / `device_sync_health_latest` function, no
 *    `v_device_sync_health_latest` view). So the rows are PAGED newest-heartbeat-first through
 *    {@link fetchAllPaged} and de-duplicated in memory by {@link distinctOnLatest}, which keeps the
 *    first occurrence of each key — identical semantics, done client-side of Postgres.
 *
 *    Paging order is `last_heartbeat_at desc NULLS LAST`, then `device_id asc` as a tiebreaker.
 *    Both matter: nulls-last means a device that has never sent a heartbeat can never outrank its
 *    own real one, and the tiebreaker makes the page boundaries stable so paging cannot skip or
 *    repeat a row.
 *
 *  - `v_stale_devices` — the backend's own triage of which devices are unhealthy, carrying a
 *    pre-computed, human-readable `reason` (`no_heartbeat` / `signed_out` / `uploads_parked`).
 *    ⚠️ It is rendered as-is. Do NOT re-derive it here: the thresholds behind it belong to the
 *    backend, and a second opinion computed in the dashboard would drift from the handset's.
 *    It is a SUBSET (only the unhealthy devices), so it is joined onto the full device list rather
 *    than used as the list.
 *
 * ── Semantics that must not be re-invented ─────────────────────────────────────────────────────
 *  - `session_state = 'signed_out'` means that handset has STOPPED uploading entirely. The CRE has
 *    to sign in again. This is the single most actionable state on the tab.
 *  - `scan_blockers` (text[]) non-empty means the phone needs someone to physically touch it —
 *    an Android permission or OEM setting the dashboard cannot fix remotely.
 *  - `last_sweep_source`: `watcher` fires the instant a call ends; `sweep` is the ~15-minute
 *    fallback poll. A device that has NEVER produced a `watcher` sweep has an OS restriction
 *    blocking background triggers. That is a claim about HISTORY, so it is computed across every
 *    row of the time series for that device — not from the latest row, which only knows what fired
 *    most recently.
 *  - `recordings_pending` is the normal upload queue, not a fault. It is reported as a number and
 *    never styled as an error. `recordings_parked` is the one that means uploads have given up.
 *  - `battery_optimised` is ALWAYS null in this project. It is deliberately not selected and not
 *    returned — a column that is always null renders as a column of em dashes and implies the
 *    dashboard failed to read something.
 *
 * ── No date filter ─────────────────────────────────────────────────────────────────────────────
 * This endpoint deliberately ignores `startDate` / `endDate`. Fleet health is CURRENT STATE, not
 * activity in a window; applying the section's "Today" default would blank the tab for every device
 * that last checked in yesterday — exactly the devices a manager needs to see. Only `branch` is
 * honoured, so the brand pills keep working.
 *
 * READ ONLY. `device_sync_health` is owned by the handsets; nothing here writes to it.
 */

/** One row of `device_sync_health`, narrowed to what this route reads. */
type DeviceHealthRow = {
  user_id: string
  device_id: string
  branch_id: string | null
  app_version: string | null
  device_model: string | null
  os_version: string | null
  last_heartbeat_at: string | null
  last_sweep_at: string | null
  last_sweep_source: string | null
  last_successful_upload_at: string | null
  recordings_pending: number | null
  recordings_parked: number | null
  scan_blockers: string[] | null
  session_state: string | null
  last_error: string | null
  first_reported_at: string | null
}

/** `v_stale_devices`, narrowed to the key plus the pre-computed reason. */
type StaleDeviceRow = {
  user_id: string
  device_id: string
  reason: string | null
  hours_since_heartbeat: number | null
}

const DEVICE_COLUMNS =
  'user_id, device_id, branch_id, app_version, device_model, os_version, last_heartbeat_at, ' +
  'last_sweep_at, last_sweep_source, last_successful_upload_at, recordings_pending, ' +
  'recordings_parked, scan_blockers, session_state, last_error, first_reported_at'

/** The sweep source that fires immediately on call end. Anything else is the fallback poll. */
const SWEEP_SOURCE_WATCHER = 'watcher'
const SESSION_SIGNED_OUT = 'signed_out'

/**
 * Ordering for the handset table: whatever needs a human first.
 *
 * Signed out outranks everything (that phone has stopped uploading), then a phone that needs
 * physically touching, then uploads that have given up, then anything the backend flagged stale.
 */
function severityRank(d: {
  sessionState: string | null
  scanBlockers: string[]
  recordingsParked: number
  reason: string | null
}): number {
  if (d.sessionState === SESSION_SIGNED_OUT) return 0
  if (d.scanBlockers.length > 0) return 1
  if (d.recordingsParked > 0) return 2
  if (d.reason) return 3
  return 4
}

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const branch = searchParams.get('branch')

  try {
    const supabase = getCreSupabase()
    const dir = await loadCreDirectory()

    // A brand pill sends a slug ("kia"), the sub-branch list sends a real uuid. Both resolve to real
    // branch ids here, and a merged brand expands back to every location it covers.
    const branchIds = resolveBranchScope(branch, dir)

    const [historyRows, staleRows] = await Promise.all([
      // Paged, never a bare select: PostgREST silently truncates an unbounded read at 1000 rows and
      // reports no error. This table grows by one row per device per sweep, so it crosses that line
      // on its own schedule.
      fetchAllPaged<DeviceHealthRow>(
        () =>
          supabase
            .from('device_sync_health')
            .select(DEVICE_COLUMNS)
            .order('last_heartbeat_at', { ascending: false, nullsFirst: false })
            .order('device_id', { ascending: true }) as any
      ),
      fetchAllPaged<StaleDeviceRow>(
        () =>
          supabase
            .from('v_stale_devices')
            .select('user_id, device_id, reason, hours_since_heartbeat')
            .order('user_id', { ascending: true })
            .order('device_id', { ascending: true }) as any
      ),
    ])

    const deviceKey = (r: { user_id: string; device_id: string }) => `${r.user_id}|${r.device_id}`

    // `distinct on (user_id, device_id) order by last_heartbeat_at desc`, in memory.
    const latest = distinctOnLatest(historyRows, deviceKey)

    // "Has this device EVER reported a watcher sweep?" — answered from the full series, because the
    // latest row only knows which source fired last.
    const everWatcher = new Set<string>()
    for (const r of historyRows) {
      if ((r.last_sweep_source || '').toLowerCase() === SWEEP_SOURCE_WATCHER) everWatcher.add(deviceKey(r))
    }

    const reasonByDevice = new Map<string, string | null>()
    for (const r of staleRows) reasonByDevice.set(deviceKey(r), r.reason)

    const now = Date.now()

    const allDevices = latest.map((r) => {
      // Same branch resolution the rest of the section uses: the row's own branch, else the CRE's
      // profile branch, canonicalised so Kia Udhampur reports under AM Kia.
      const resolvedBranch = resolveBranchId({ branch_id: r.branch_id, cre_id: r.user_id }, dir)
      const scanBlockers = (r.scan_blockers || []).filter(Boolean)
      const sessionState = (r.session_state || '').toLowerCase() || null
      const recordingsParked = Number(r.recordings_parked) || 0
      const reason = reasonByDevice.get(deviceKey(r)) ?? null
      const heartbeatMs = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : null

      return {
        creId: r.user_id,
        // `user_profiles.full_name`. There is no CRE-name literal anywhere in this section.
        creName: dir.profileName.get(r.user_id) || 'CRE Agent',
        branchId: resolvedBranch,
        branchName: branchLabel(resolvedBranch, dir),
        deviceId: r.device_id,
        deviceModel: r.device_model || null,
        osVersion: r.os_version || null,
        appVersion: r.app_version || null,
        lastHeartbeatAt: r.last_heartbeat_at,
        /** Null when the handset has never sent a heartbeat — rendered as an em dash, never a 0. */
        hoursSinceHeartbeat:
          heartbeatMs === null ? null : Math.round(((now - heartbeatMs) / 3_600_000) * 10) / 10,
        lastSweepAt: r.last_sweep_at,
        lastSweepSource: r.last_sweep_source || null,
        lastSuccessfulUploadAt: r.last_successful_upload_at,
        sessionState,
        /** Signed out = this handset has STOPPED uploading. The CRE must sign in again. */
        isSignedOut: sessionState === SESSION_SIGNED_OUT,
        scanBlockers,
        /** Normal upload queue. Not a fault — see the header. */
        recordingsPending: Number(r.recordings_pending) || 0,
        recordingsParked,
        lastError: r.last_error || null,
        /** Pre-computed by `v_stale_devices`. Rendered as-is; null when the backend is happy. */
        reason,
        /**
         * True when NO sweep this device ever reported came from the instant-on-call-end watcher —
         * an OS restriction is blocking the background trigger and every recording arrives late,
         * via the ~15-minute fallback poll.
         */
        watcherNeverFired: !everWatcher.has(deviceKey(r)),
        // `battery_optimised` is intentionally absent: it is always null in this project.
      }
    })

    // A CRE counts as "has a handset" if the app has EVER reported from any device of theirs,
    // regardless of the branch filter — otherwise switching brands would invent missing handsets.
    const creIdsWithDevice = new Set(historyRows.map((r) => r.user_id))

    const devices = (branchIds ? allDevices.filter((d) => d.branchId && branchIds.includes(d.branchId)) : allDevices)
      .sort(
        (a, b) =>
          severityRank(a) - severityRank(b) ||
          a.creName.localeCompare(b.creName) ||
          (b.lastHeartbeatAt || '').localeCompare(a.lastHeartbeatAt || '')
      )

    /**
     * The highest-value output on this tab.
     *
     * A CRE with NO row in `device_sync_health` at all has never had the app report from a handset —
     * it was never deployed to their phone. That is the honest answer to "why does this CRE show no
     * calls", and no amount of staring at the call log reveals it.
     *
     * Scoped by the same branch filter as everything else so the number agrees with the brand pill.
     */
    const missingDevices = creRosterForBranches(branchIds, dir)
      .filter((p) => !creIdsWithDevice.has(p.id))
      .map((p) => {
        const resolvedBranch = resolveBranchId({ cre_id: p.id }, dir)
        return {
          creId: p.id,
          creName: p.full_name || 'CRE Agent',
          branchId: resolvedBranch,
          branchName: branchLabel(resolvedBranch, dir),
        }
      })
      .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.creName.localeCompare(b.creName))

    const rosterSize = creRosterForBranches(branchIds, dir).length

    return NextResponse.json({
      devices,
      missingDevices,
      summary: {
        /** Handsets, not CREs — a reinstall re-registers and mints a new `device_id`. */
        deviceCount: devices.length,
        /** Distinct CREs among those handsets. */
        creWithDeviceCount: new Set(devices.map((d) => d.creId)).size,
        /** Active CREs in scope, from `user_profiles` (role `cre`, status `active`). */
        rosterSize,
        missingDeviceCount: missingDevices.length,
        signedOutCount: devices.filter((d) => d.isSignedOut).length,
        scanBlockedCount: devices.filter((d) => d.scanBlockers.length > 0).length,
        /** Devices `v_stale_devices` currently flags, for any of its reasons. */
        staleCount: devices.filter((d) => d.reason).length,
        watcherNeverFiredCount: devices.filter((d) => d.watcherNeverFired).length,
        /** Recordings queued on handsets right now. Normal traffic, shown for scale. */
        pendingUploads: devices.reduce((n, d) => n + d.recordingsPending, 0),
        /** Uploads that have given up. Unlike `pending`, this one is a fault. */
        parkedUploads: devices.reduce((n, d) => n + d.recordingsParked, 0),
      },
    })
  } catch (error) {
    console.error('[AM-Group-Fleet-Health] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load fleet health' },
      { status: 500 }
    )
  }
}
