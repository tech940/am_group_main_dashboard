import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'
import {
  applyBranchScope,
  applySearch,
  branchLabel,
  creRosterForBranches,
  fetchActivityRows,
  fetchAllPaged,
  foldLogRowsToActivity,
  formatSeconds,
  istDayEnd,
  istDayStart,
  loadCreDirectory,
  resolveBranchId,
  resolveBranchScope,
  OUTCOME_ANSWERED,
  UNASSIGNED_BRANCH_ID,
  type ActivityRow,
  type CreDirectory,
  type RawLogRow,
} from '@/lib/cre-calls/directory'

export const dynamic = 'force-dynamic'

/**
 * AM Group CRE Call Analysis — summary / KPI endpoint.
 *
 * SOURCE OF TRUTH is `v_call_activity`, the reporting view the backend ships. It pre-aggregates
 * `call_log_entries` into (day, cre_id, branch_id) buckets and each day is bucketed in its own
 * BRANCH'S timezone, so this route does no date arithmetic of its own on the view path.
 *
 * Why the view rather than a hand-rolled rollup:
 *  - it is the backend's definition of every metric, so the dashboard and the backend cannot drift;
 *  - it moves the GROUP BY into Postgres. The previous version paged the whole filtered call log
 *    across the wire just to bucket it in JavaScript;
 *  - it already classifies outcomes correctly. The hand-rolled version treated only `missed` and
 *    `no_answer` as unanswered and silently dropped `rejected`.
 *
 * What the view deliberately does NOT settle, and how this route handles it:
 *  - `total_attempts >= answered_calls + unanswered_calls`. The gap is `outcome = 'unknown'` and is
 *    in NEITHER bucket on purpose. It is reported as its own `unclassified` number and its own
 *    slice of the outcome mix — never folded into one of the other two.
 *  - the view has no `direction × outcome` split for ANSWERED calls, and
 *    `outgoing_attempts - outgoing_unanswered` is not a safe substitute (it absorbs unknown
 *    outgoing calls). The two headline splits that need it — connected outgoing / connected
 *    incoming — come from exact `count: 'exact', head: true` counts, which never move rows.
 *  - the view carries no `phone` / `contact_name`, so a free-text search cannot run against it.
 *    A search falls back to a paged read of `call_log_entries` folded into the SAME shape, so the
 *    two paths can never answer the same question differently.
 *
 * The roster-seeding rule survives the rewrite: `v_call_activity` only has rows for days a CRE
 * actually worked, so a CRE with zero calls would vanish from the scorecard. Active CREs from
 * `user_profiles` are seeded in with empty buckets — a real, reportable zero.
 *
 * Nothing here is estimated, scaled, or hardcoded. Anything the data cannot express is `null` and
 * the UI renders an em dash.
 */

type Filters = {
  startDate: string | null
  endDate: string | null
  agent: string | null
  branchIds: string[] | null
  search: string
}

/** A `call_log_entries` query with every active filter applied — used for exact counts only. */
function buildLogQuery(
  filters: Filters,
  dir: CreDirectory,
  select: string,
  opts?: { count: 'exact'; head: true }
) {
  const supabase = getCreSupabase()
  let query = opts
    ? supabase.from('call_log_entries').select(select, opts)
    : supabase.from('call_log_entries').select(select)

  query = query.is('deleted_at', null)
  // Row-level table: `started_at` is a timestamptz, so the user's LOCAL (IST) calendar date has to
  // become an instant range. The view path needs none of this — see istDayStart.
  if (filters.startDate) query = query.gte('started_at', istDayStart(filters.startDate))
  if (filters.endDate) query = query.lte('started_at', istDayEnd(filters.endDate))
  if (filters.agent && filters.agent !== 'all') query = query.eq('cre_id', filters.agent)
  if (filters.branchIds) query = applyBranchScope(query, filters.branchIds, dir)
  if (filters.search) query = applySearch(query, filters.search, dir)
  return query
}

/** Exact row count computed by Postgres — no rows cross the wire, no 1000-row cap to hit. */
async function countWhere(filters: Filters, dir: CreDirectory, refine: (q: any) => any): Promise<number> {
  const { count, error } = await refine(buildLogQuery(filters, dir, 'id', { count: 'exact', head: true }))
  if (error) throw new Error(`Failed to count CRE calls: ${error.message}`)
  return count ?? 0
}

/** Running totals over a set of {@link ActivityRow}s. */
type Totals = {
  attempts: number
  answered: number
  unanswered: number
  missedIncoming: number
  outgoingAttempts: number
  outgoingUnanswered: number
  incomingAttempts: number
  talkSeconds: number
  recorded: number
}

const ZERO_TOTALS = (): Totals => ({
  attempts: 0,
  answered: 0,
  unanswered: 0,
  missedIncoming: 0,
  outgoingAttempts: 0,
  outgoingUnanswered: 0,
  incomingAttempts: 0,
  talkSeconds: 0,
  recorded: 0,
})

function addRow(t: Totals, r: ActivityRow): Totals {
  t.attempts += Number(r.total_attempts) || 0
  t.answered += Number(r.answered_calls) || 0
  t.unanswered += Number(r.unanswered_calls) || 0
  t.missedIncoming += Number(r.missed_calls) || 0
  t.outgoingAttempts += Number(r.outgoing_attempts) || 0
  t.outgoingUnanswered += Number(r.outgoing_unanswered) || 0
  t.incomingAttempts += Number(r.incoming_attempts) || 0
  t.talkSeconds += Number(r.total_talk_time_seconds) || 0
  t.recorded += Number(r.recorded_calls) || 0
  return t
}

/** Bucket activity rows by an arbitrary key, summing every metric. */
function groupTotals<K>(rows: ActivityRow[], keyOf: (r: ActivityRow) => K): Map<K, Totals> {
  const out = new Map<K, Totals>()
  for (const r of rows) {
    const k = keyOf(r)
    const bucket = out.get(k) || ZERO_TOTALS()
    out.set(k, addRow(bucket, r))
  }
  return out
}

const pct = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : 0

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canViewCallAnalysis(appUser.role)) {
    return NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const agent = searchParams.get('agent')
  const branch = searchParams.get('branch')
  const search = (searchParams.get('search') || '').trim()

  try {
    const dir = await loadCreDirectory()

    // A brand pill sends a slug ("kia", "am_group"); the sub-branch list sends a real uuid. Both are
    // mapped to branch ids here. Passing either straight into `.eq('branch_id', ...)` used to make
    // Postgres reject the query with `invalid input syntax for type uuid` and 500 the whole tab.
    const branchIds = resolveBranchScope(branch, dir)
    const filters: Filters = { startDate, endDate, agent, branchIds, search }

    // Brand / branch options are derived from `branch_directory.brand`, never from a hardcoded list.
    // `brandReportingBranchIds` is the MERGED view: Kia's two locations collapse to one AM Kia
    // entry, which also means `subBranches.length` drops to 1 and the client stops drawing the
    // Jammu / Udhampur location pills. Ordering is by slug so relabelling a brand cannot reshuffle it.
    const brandOrder = ['kia', 'hyundai', 'honda', 'ktm']
    const branchOptions = [...dir.brandReportingBranchIds.entries()]
      .filter(([slug]) => slug !== 'am_group')
      .map(([slug, ids]) => ({
        id: slug,
        name: dir.brandName.get(slug) || slug,
        subBranches: ids.map((id) => ({ id, name: branchLabel(id, dir) })),
      }))
      .sort((a, b) => {
        const ai = brandOrder.indexOf(a.id)
        const bi = brandOrder.indexOf(b.id)
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
      })

    // ---- Activity rows -------------------------------------------------------------------------
    // No search: read the view (Postgres does the GROUP BY). With a search: page the narrow log
    // projection and fold it into the identical shape. Both are paged — an unbounded select would
    // be silently capped at 1000 rows.
    const activity: ActivityRow[] = search
      ? foldLogRowsToActivity(
          await fetchAllPaged<RawLogRow>(() =>
            buildLogQuery(
              filters,
              dir,
              'cre_id, branch_id, direction, outcome, duration_seconds, started_at, recording_id'
            ).order('started_at', { ascending: true }) as any
          ),
          dir
        )
      : await fetchActivityRows({ startDate, endDate, agent, branchIds }, dir)

    const totals = activity.reduce((t, r) => addRow(t, r), ZERO_TOTALS())

    // The two splits the view cannot express exactly. Counted by Postgres, not derived from
    // `outgoing_attempts - outgoing_unanswered` (which would absorb unknown-outcome calls).
    const [connectedOutgoing, connectedIncoming] = await Promise.all([
      countWhere(filters, dir, (q) => q.eq('direction', 'outgoing').eq('outcome', OUTCOME_ANSWERED)),
      countWhere(filters, dir, (q) => q.eq('direction', 'incoming').eq('outcome', OUTCOME_ANSWERED)),
    ])

    // Calls the handset logged but could not classify. Kept visible instead of reconciled away.
    const unclassified = Math.max(0, totals.attempts - totals.answered - totals.unanswered)
    const avgDurationSeconds = totals.answered > 0 ? totals.talkSeconds / totals.answered : 0

    // ---- Per-CRE scorecard ---------------------------------------------------------------------
    const creTotals = groupTotals(activity, (r) => r.cre_id || UNASSIGNED_BRANCH_ID)
    // "How many CREs actually worked in this range" — measured before the roster is folded in, so
    // the seeded zero rows can never inflate it.
    const activeCreCount = creTotals.size

    /*
     * The scorecard's dimension is the CRE ROSTER, not the set of activity rows.
     *
     * `v_call_activity` only has rows for days with activity, so a CRE who has not dialled yet in
     * the selected range simply does not exist in it — which is why this section once looked like
     * it had one agent on the "Today" default while the branch held seven. A CRE with zero calls is
     * a real, reportable zero and the single most useful row a manager can see, so the roster
     * (`user_profiles`, role `cre`, active) is seeded in with empty totals.
     *
     * Two deliberate exclusions:
     *  - a free-text search narrows to matching rows; padding it with every zero-call CRE would
     *    bury the result the user asked for.
     *  - a CRE whose profile names no branch is still seeded under "Unassigned" rather than hidden.
     */
    if (!filters.search) {
      for (const p of creRosterForBranches(filters.branchIds, dir)) {
        if (filters.agent && filters.agent !== 'all' && p.id !== filters.agent) continue
        if (!creTotals.has(p.id)) creTotals.set(p.id, ZERO_TOTALS())
      }
    }

    // A CRE's rows are split across branch buckets (the view groups on the RAW `branch_id`, which
    // is null whenever the handset did not stamp one). Prefer a bucket that names a branch; fall
    // back to the CRE's profile branch, which is the only answer for a seeded zero-call row.
    const creBranch = new Map<string, string | null>()
    for (const r of activity) {
      const id = r.cre_id || UNASSIGNED_BRANCH_ID
      if (creBranch.get(id)) continue
      creBranch.set(id, resolveBranchId(r, dir))
    }

    const crePerformance = [...creTotals.entries()]
      .map(([creId, t]) => {
        const branchId = creBranch.get(creId) ?? resolveBranchId({ cre_id: creId }, dir)
        return {
          cre_id: creId,
          cre_name:
            creId === UNASSIGNED_BRANCH_ID ? 'Unassigned CRE' : dir.profileName.get(creId) || 'CRE Agent',
          branch_id: branchId,
          branch_name: branchLabel(branchId, dir),
          brand: branchId ? dir.branchBrand.get(branchId) || null : null,
          /** Attempts in the SELECTED DATE RANGE. Key kept for backwards compatibility. */
          calls_this_month: t.attempts,
          connected_calls: t.answered,
          // Recomputed from the summed numerator/denominator. `answer_rate_pct` is per-row and
          // cannot be averaged across days or branches.
          connect_rate: pct(t.answered, t.attempts),
          /** Everything the view counts as unanswered: missed + no_answer + rejected. */
          unanswered_calls: t.unanswered,
          /** Incoming calls not picked up. A strict subset of `unanswered_calls`. */
          missed_calls: t.missedIncoming,
          /** attempts − answered − unanswered. `outcome = 'unknown'`; not an error. */
          unclassified_calls: Math.max(0, t.attempts - t.answered - t.unanswered),
          avg_duration_seconds: t.answered > 0 ? Math.round(t.talkSeconds / t.answered) : 0,
          total_talk_time_seconds: t.talkSeconds,
        }
      })
      // Busiest first, then alphabetical so the zero-call block is stable and scannable.
      .sort((a, b) => b.calls_this_month - a.calls_this_month || a.cre_name.localeCompare(b.cre_name))

    // ---- Per-branch rollup ---------------------------------------------------------------------
    // `resolveBranchId` returns the CANONICAL id, so a call logged at Kia Udhampur lands in the same
    // bucket as one logged at Kia Jammu and the table shows a single AM Kia row.
    const branchTotals = groupTotals(activity, (r) => resolveBranchId(r, dir) || UNASSIGNED_BRANCH_ID)

    // Same roster principle as the CRE scorecard: a dealership with no calls in range reports a
    // real zero instead of disappearing, so the table always agrees with the brand pills above it.
    // Only branded rows qualify — the brand-less admin branches are not dealerships.
    if (!filters.search) {
      const brandedIds = new Set(dir.branches.filter((b) => b.brand).map((b) => b.id))
      for (const id of filters.branchIds ?? [...brandedIds]) {
        if (!brandedIds.has(id)) continue
        const canonical = dir.canonicalBranchId.get(id) || id
        if (!branchTotals.has(canonical)) branchTotals.set(canonical, ZERO_TOTALS())
      }
    }

    // Columns are exactly what `v_call_activity` expresses. There is deliberately no per-branch
    // "connected outgoing / connected incoming" split: the view cannot give one and deriving it
    // from `outgoing_attempts - outgoing_unanswered` would quietly count unknown-outcome calls as
    // connected. Attempts-by-direction is honest and answers the same operational question.
    const branchPerformance = [...branchTotals.entries()]
      .map(([branchId, t]) => ({
        id: branchId,
        name: branchLabel(branchId, dir),
        calls: t.attempts,
        totalConnected: t.answered,
        outgoingAttempts: t.outgoingAttempts,
        outgoingUnanswered: t.outgoingUnanswered,
        incomingAttempts: t.incomingAttempts,
        missedIncoming: t.missedIncoming,
        totalUnanswered: t.unanswered,
        connectRate: pct(t.answered, t.attempts),
        unansweredRate: pct(t.unanswered, t.attempts),
        duration: t.talkSeconds,
        durationLabel: formatSeconds(t.talkSeconds),
      }))
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))

    // ---- Daily trend ---------------------------------------------------------------------------
    // `day` already IS a calendar date in the branch's own timezone. No slicing of a timestamp.
    const dayTotals = groupTotals(activity, (r) => r.day)
    const dailyTrend = [...dayTotals.entries()]
      .map(([date, t]) => ({
        date,
        calls: t.attempts,
        duration: t.talkSeconds,
        connected: t.answered,
        unanswered: t.unanswered,
        missedIncoming: t.missedIncoming,
        missedOutgoing: t.outgoingUnanswered,
        incomingAttempts: t.incomingAttempts,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Sparklines mirror the real daily series. With fewer than two days there is no trend to draw,
    // so the arrays come back empty and the cards render the number without a chart — they are
    // never padded with invented history.
    const recent = dailyTrend.slice(-7)
    const hasSeries = recent.length >= 2
    const series = <T,>(fn: (t: (typeof recent)[number]) => T) => (hasSeries ? recent.map(fn) : [])
    const sparklines = {
      callsSeries: series((t) => t.calls),
      recordingsSeries: series((t) => t.connected),
      durationSeries: series((t) => t.duration),
      avgDurationSeries: series((t) => (t.connected > 0 ? Math.round(t.duration / t.connected) : 0)),
      uniquePhonesSeries: [] as number[],
      missedIncomingSeries: series((t) => t.missedIncoming),
      missedOutgoingSeries: series((t) => t.missedOutgoing),
      unansweredSeries: series((t) => t.unanswered),
      incomingSeries: series((t) => t.incomingAttempts),
      agentsSeries: [] as number[],
    }

    // The full outcome breakdown. "Other Unanswered" is what is left of `unanswered_calls` once the
    // two named buckets are removed (incoming no-answer, rejected, outgoing missed) — it is derived
    // by subtraction from the view's own totals, so the slices always sum to the total. The
    // unclassified slice is the `outcome = 'unknown'` gap, shown rather than hidden.
    const otherUnanswered = Math.max(
      0,
      totals.unanswered - totals.missedIncoming - totals.outgoingUnanswered
    )
    const callTypeMix = [
      { name: 'Connected Outgoing', value: connectedOutgoing },
      { name: 'Connected Incoming', value: connectedIncoming },
      { name: 'Missed Incoming', value: totals.missedIncoming },
      { name: 'Not Answered Outgoing', value: totals.outgoingUnanswered },
      { name: 'Other Unanswered', value: otherUnanswered },
      { name: 'Unclassified', value: unclassified },
    ].filter((slice) => slice.value > 0)

    const agentsList = crePerformance.map((c) => ({
      id: c.cre_id,
      name: c.cre_name,
      branchName: c.branch_name,
      calls: c.calls_this_month,
      recordings: c.connected_calls,
      duration: c.total_talk_time_seconds,
      durationLabel: formatSeconds(c.total_talk_time_seconds),
      avgDurationSeconds: c.avg_duration_seconds,
      missedIncoming: c.missed_calls,
      missedOutgoing: Math.max(0, c.unanswered_calls - c.missed_calls),
      connected: c.connected_calls,
      connectRate: c.connect_rate,
    }))

    return NextResponse.json({
      // `source` is diagnostic: it says which path produced these numbers.
      source: search ? 'call_log_entries' : 'v_call_activity',
      summary: {
        totalCalls: totals.attempts,
        totalDurationSeconds: totals.talkSeconds,
        totalDurationLabel: formatSeconds(totals.talkSeconds),
        avgDurationSeconds: Math.round(avgDurationSeconds),
        avgDurationLabel: formatSeconds(avgDurationSeconds),
        withRecording: totals.recorded,
        recordingCoverage: pct(totals.recorded, totals.attempts),
        // `v_call_activity` cannot answer "how many distinct numbers"; answering it would mean
        // pulling every row's phone across the wire. Null renders as an em dash rather than a lie.
        uniquePhones: null as number | null,
        connectedOutgoing,
        connectedIncoming,
        missedIncoming: totals.missedIncoming,
        missedOutgoing: totals.outgoingUnanswered,
        outgoingAttempts: totals.outgoingAttempts,
        incomingAttempts: totals.incomingAttempts,
        totalUnanswered: totals.unanswered,
        totalConnected: totals.answered,
        /** attempts − answered − unanswered. Real calls with `outcome = 'unknown'`. */
        unclassified,
        connectRate: pct(totals.answered, totals.attempts),
        unansweredRate: pct(totals.unanswered, totals.attempts),
        // CREs who made or received at least one call in range — NOT the roster size.
        agentCount: activeCreCount,
      },
      sparklines,
      dailyTrend,
      callTypeMix,
      crePerformance,
      branchPerformance,
      agents: agentsList,
      facets: {
        agentOptions: crePerformance.map((c) => ({ id: c.cre_id, name: c.cre_name })),
        branchOptions,
        totalCallsAvailable: totals.attempts,
      },
    })
  } catch (error) {
    console.error('[AM-Group-Call-Analysis] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load AM Group Call Analysis' },
      { status: 500 }
    )
  }
}
