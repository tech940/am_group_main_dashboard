import type { PostgrestFilterBuilder } from '@supabase/postgrest-js'
import { getCreSupabase } from './cre-supabase'

/**
 * Shared CRE-call directory + filter helpers.
 *
 * Everything here reads the CRE Supabase project. Nothing in this file may invent a value: if the
 * data cannot answer a question the caller gets `null` and the UI renders an em dash. The section
 * previously shipped hardcoded KPI literals and 94 fabricated phone numbers; the rule now is that
 * every number on the page traces back to a row in `call_log_entries` or `call_recordings`.
 *
 * Schema facts this file depends on (verified against the live project, not assumed):
 *  - `call_log_entries` and `call_recordings` both carry `cre_id` -> `user_profiles.id` and a
 *    denormalised `branch_id` -> `branches.id`. `branch_id` is NULL on a large minority of rows
 *    (181 of 912 in `call_log_entries` at the time of writing), which is why
 *    {@link resolveBranchId} has a profile fallback. `v_call_activity` groups on the RAW
 *    `branch_id`, so the same fallback applies to view rows.
 *  - There is no `cre_profiles` table. CRE names come from `user_profiles.full_name`.
 *  - `branch_directory` and `branches` share the same primary keys, so a row's `branch_id` is a
 *    valid key into either. `branch_directory` is used here because it carries `brand`.
 *
 * ⚠️ PostgREST embedding: `user_profiles` has MORE THAN ONE foreign key to `branches`, so a bare
 * embed (`.select('full_name, branches(code)')`) fails with "Could not embed because more than one
 * relationship was found". Any join MUST name the constraint:
 *     .select('full_name, branch:branches!user_profiles_branch_id_fkey(code, brand)')
 * Nothing in this file embeds — the directory is loaded as two flat reads and joined in memory —
 * but the rule applies to anything added later.
 *
 * ⚠️ PostgREST row cap: an unbounded `.select()` is silently truncated at `db-max-rows` (1000) with
 * NO error. Every read here that can exceed that goes through {@link fetchAllPaged}, and everything
 * that only needs a number uses `{ count: 'exact', head: true }` so Postgres does the counting.
 *
 * READ ONLY: the CRE project's schema is production and the handsets own it. Nothing in this
 * module or its callers may write to `call_recordings`, `call_log_entries` or `device_sync_health`.
 */

/** Branches that are in the directory but are not dealerships we report on. */
const EXCLUDED_BRANCH_CODES = new Set(['DEL', 'SXR'])

/**
 * Brands whose physical locations are reported as ONE entity.
 *
 * Kia trades as a single dealership: "AM Kia Jammu" and "AM Kia Udhampur" are two rows in
 * `branch_directory` but one business to everyone reading this section, and every CRE belongs to
 * the same team. Collapsing here rather than in the client means the brand pills, the branch
 * filter, the Branch-Wise tab and every branch column inherit it from one place — and, critically,
 * that the SQL scope and the display grouping can never disagree.
 *
 * Keyed by brand slug; the value is the label the merged entity reports under.
 */
const MERGED_BRANDS = new Map<string, string>([['kia', 'AM Kia']])

/** Shown wherever a call cannot be traced to a branch. Never hide such a call — count it honestly. */
export const UNASSIGNED_BRANCH_ID = 'unassigned'
export const UNASSIGNED_BRANCH_LABEL = 'Unassigned'

export type BranchRow = { id: string; code: string | null; brand: string | null; display_name: string | null }
export type ProfileRow = {
  id: string
  full_name: string | null
  branch_id: string | null
  role: string | null
  status: string | null
  deleted_at: string | null
}

export type CreDirectory = {
  /** Every reportable branch row, un-merged. Use these ids for SQL scope, never for display. */
  branches: BranchRow[]
  profiles: ProfileRow[]
  /** Active CREs only — the roster the scorecard is drawn from. */
  creProfiles: ProfileRow[]
  /** branch id -> display name. Contains BOTH real and canonical ids, so any id resolves. */
  branchName: Map<string, string>
  /** branch id -> brand label, e.g. "Kia" */
  branchBrand: Map<string, string | null>
  /** cre id -> full name */
  profileName: Map<string, string>
  /** cre id -> the branch on their profile (used when a call row has no branch_id of its own) */
  profileBranch: Map<string, string | null>
  /** brand slug ("am_group") -> REAL branch ids owned by that brand. For SQL scope. */
  brandBranchIds: Map<string, string[]>
  /** brand slug -> the branch ids that brand REPORTS as. Kia collapses to one. For UI options. */
  brandReportingBranchIds: Map<string, string[]>
  /** brand slug -> the label its pill shows ("AM Kia" for the merged brand, else the brand name). */
  brandName: Map<string, string>
  /** real branch id -> the id it is reported under. Identity for every unmerged brand. */
  canonicalBranchId: Map<string, string>
  /** canonical branch id -> every real branch id folded into it (always includes itself). */
  branchMembers: Map<string, string[]>
}

/** "AM Group" -> "am_group". The brand pills in the UI send these slugs. */
export function brandSlug(brand: string): string {
  return brand.trim().toLowerCase().replace(/\s+/g, '_')
}

export async function loadCreDirectory(): Promise<CreDirectory> {
  const supabase = getCreSupabase()

  // Paged, not a bare select. PostgREST caps an unbounded request at `db-max-rows` (1000 by
  // default) and reports no error when it truncates — a silently short profile list would strip
  // every CRE's name and drop them from `creIdsForBranches`, which is exactly the class of bug
  // that made this section show one agent.
  const [profilesRaw, branchesRaw] = await Promise.all([
    fetchAllPaged<ProfileRow>(
      () =>
        supabase
          .from('user_profiles')
          .select('id, full_name, branch_id, role, status, deleted_at')
          .order('id', { ascending: true }) as unknown as AnyQuery
    ).catch((e) => {
      throw new Error(`Failed to load CRE profiles: ${e instanceof Error ? e.message : String(e)}`)
    }),
    fetchAllPaged<BranchRow>(
      () =>
        supabase
          .from('branch_directory')
          .select('id, code, brand, display_name')
          .order('id', { ascending: true }) as unknown as AnyQuery
    ).catch((e) => {
      throw new Error(`Failed to load branch directory: ${e instanceof Error ? e.message : String(e)}`)
    }),
  ])

  const specialBranch = branchesRaw.find(
    (b) => (b.code || '').toUpperCase() === 'SPECIAL' || (b.display_name || '').toLowerCase().includes('special team')
  )
  const specialBranchId = specialBranch?.id || '4d1d906b-6850-4a90-8309-e2ed9e61c6cb'

  const branches = branchesRaw.filter((b) => !EXCLUDED_BRANCH_CODES.has((b.code || '').toUpperCase()))
  for (const b of branches) {
    if (!b.brand && (b.id === specialBranchId || (b.code || '').toUpperCase() === 'SPECIAL' || (b.display_name || '').toLowerCase().includes('special team'))) {
      b.brand = 'Special Team'
    }
  }

  const profiles = profilesRaw.filter((p) => !p.deleted_at)
  const creProfiles = profiles.filter((p) => (p.role === 'cre' || p.branch_id === specialBranchId) && p.status === 'active')

  // ---- Brand grouping + merged-brand collapse ------------------------------------------------
  const brandBranchIds = new Map<string, string[]>()
  for (const b of branches) {
    if (!b.brand) continue
    const slug = brandSlug(b.brand)
    brandBranchIds.set(slug, [...(brandBranchIds.get(slug) || []), b.id])
  }

  const canonicalBranchId = new Map<string, string>()
  const branchMembers = new Map<string, string[]>()
  const brandReportingBranchIds = new Map<string, string[]>()
  const brandName = new Map<string, string>()
  const mergedLabel = new Map<string, string>()

  for (const [slug, ids] of brandBranchIds) {
    const label = MERGED_BRANDS.get(slug)
    const rawBrand = branches.find((b) => b.id === ids[0])?.brand || slug
    brandName.set(slug, label || rawBrand)
    if (!label) {
      // Unmerged brand: every branch reports as itself.
      for (const id of ids) {
        canonicalBranchId.set(id, id)
        branchMembers.set(id, [id])
      }
      brandReportingBranchIds.set(slug, [...ids])
      continue
    }
    // Merged brand: one canonical id, chosen deterministically so it is stable across requests
    // (the UI stores it in query state, so it must not move between renders).
    const members = [...ids].sort()
    const canonical = members[0]
    for (const id of members) canonicalBranchId.set(id, canonical)
    branchMembers.set(canonical, members)
    brandReportingBranchIds.set(slug, [canonical])
    mergedLabel.set(canonical, label)
  }

  // Branches with no brand still need to resolve to themselves.
  for (const b of branches) {
    if (canonicalBranchId.has(b.id)) continue
    canonicalBranchId.set(b.id, b.id)
    branchMembers.set(b.id, [b.id])
  }

  const branchName = new Map<string, string>()
  const branchBrand = new Map<string, string | null>()
  for (const b of branches) {
    const canonical = canonicalBranchId.get(b.id) || b.id
    const label = mergedLabel.get(canonical) || b.display_name || b.code || 'Unknown Branch'
    // Keyed under BOTH the real id and the canonical id: a caller holding a raw `branch_id` off a
    // call row gets the merged label without having to canonicalise first.
    branchName.set(b.id, label)
    branchName.set(canonical, label)
    branchBrand.set(b.id, b.brand)
    branchBrand.set(canonical, branchBrand.get(canonical) ?? b.brand)
  }

  return {
    branches,
    profiles,
    creProfiles,
    branchName,
    branchBrand,
    profileName: new Map(profiles.map((p) => [p.id, p.full_name || 'CRE Agent'])),
    profileBranch: new Map(profiles.map((p) => [p.id, p.branch_id])),
    brandBranchIds,
    brandReportingBranchIds,
    brandName,
    canonicalBranchId,
    branchMembers,
  }
}

/**
 * The branch a call is REPORTED under.
 *
 * Two rules, both load-bearing:
 *  1. `branch_id` is null on the majority of rows (the handset agent does not always stamp it), so
 *     the CRE's own profile branch is the fallback. Any SQL filter on branch MUST mirror this or it
 *     silently drops most of the table.
 *  2. The result is canonicalised, so a Kia call logged in Udhampur reports under AM Kia.
 *
 * Returns null only when neither the row nor the CRE's profile names a branch. Callers must render
 * that as {@link UNASSIGNED_BRANCH_LABEL} — never drop the row.
 */
export function resolveBranchId(
  row: { branch_id?: string | null; cre_id?: string | null },
  dir: CreDirectory
): string | null {
  const raw = row.branch_id || (row.cre_id ? dir.profileBranch.get(row.cre_id) ?? null : null) || null
  if (!raw) return null
  return dir.canonicalBranchId.get(raw) || raw
}

/** Display name for a resolved branch id, including the honest fallback for "we do not know". */
export function branchLabel(branchId: string | null | undefined, dir: CreDirectory): string {
  if (!branchId || branchId === UNASSIGNED_BRANCH_ID) return UNASSIGNED_BRANCH_LABEL
  return dir.branchName.get(branchId) || UNASSIGNED_BRANCH_LABEL
}

/**
 * Branch ids a `branch` query param selects, or null for "no branch restriction".
 *
 * Always returns REAL branch ids: a merged entity expands back to every location it covers so the
 * SQL scope matches what the label promises.
 */
export function resolveBranchScope(branch: string | null, dir: CreDirectory): string[] | null {
  if (!branch || branch === 'all') return null
  const byBrand = dir.brandBranchIds.get(branch)
  if (byBrand && byBrand.length > 0) return byBrand
  // A concrete branch id straight from the sub-branch list. Expand it through the merge map so
  // selecting "AM Kia" covers Jammu and Udhampur alike.
  const canonical = dir.canonicalBranchId.get(branch)
  if (canonical) return dir.branchMembers.get(canonical) || [branch]
  if (dir.branchName.has(branch)) return [branch]
  return []
}

/** CRE ids whose profile branch sits inside `branchIds`. */
export function creIdsForBranches(branchIds: string[], dir: CreDirectory): string[] {
  const wanted = new Set(branchIds)
  return dir.profiles.filter((p) => p.branch_id && wanted.has(p.branch_id)).map((p) => p.id)
}

/** Active CREs whose profile branch sits inside `branchIds` — the roster for a scoped scorecard. */
export function creRosterForBranches(branchIds: string[] | null, dir: CreDirectory): ProfileRow[] {
  if (!branchIds) return dir.creProfiles
  const wanted = new Set(branchIds)
  return dir.creProfiles.filter((p) => p.branch_id && wanted.has(p.branch_id))
}

type AnyQuery = PostgrestFilterBuilder<any, any, any, any, any>

/**
 * Apply branch scope to a query using the same resolution as {@link resolveBranchId}: match rows
 * that carry the branch explicitly, plus rows with no branch whose CRE belongs to it.
 */
export function applyBranchScope<Q extends AnyQuery>(query: Q, branchIds: string[], dir: CreDirectory): Q {
  if (branchIds.length === 0) {
    // A brand with no branches in the directory must return nothing, not everything.
    return query.eq('branch_id', '00000000-0000-0000-0000-000000000000') as Q
  }
  const creIds = creIdsForBranches(branchIds, dir)
  const clauses = [`branch_id.in.(${branchIds.join(',')})`]
  if (creIds.length > 0) clauses.push(`and(branch_id.is.null,cre_id.in.(${creIds.join(',')}))`)
  return query.or(clauses.join(',')) as Q
}

/**
 * Apply the free-text search box. Matches the phone or saved contact name directly, and resolves
 * CRE-name / branch-name matches to the cre ids they cover so the whole thing stays in SQL.
 */
export function applySearch<Q extends AnyQuery>(query: Q, search: string, dir: CreDirectory): Q {
  const term = search.trim()
  if (!term) return query

  const lower = term.toLowerCase()
  // Match the name the user can actually see (the merged label, e.g. "AM Kia") as well as the raw
  // directory name, so both "am kia" and a remembered "udhampur" still find their calls.
  const matchedBranchIds = new Set(
    dir.branches
      .filter(
        (b) =>
          (b.display_name || '').toLowerCase().includes(lower) ||
          (dir.branchName.get(b.id) || '').toLowerCase().includes(lower)
      )
      .map((b) => b.id)
  )
  const matchedCreIds = dir.profiles
    .filter(
      (p) =>
        (p.full_name || '').toLowerCase().includes(lower) ||
        (p.branch_id ? matchedBranchIds.has(p.branch_id) : false)
    )
    .map((p) => p.id)

  // PostgREST `or` values cannot contain bare commas or parentheses.
  const safe = term.replace(/[,()*]/g, ' ').trim()
  const clauses = [`phone.ilike.*${safe}*`, `contact_name.ilike.*${safe}*`]
  if (matchedCreIds.length > 0) clauses.push(`cre_id.in.(${matchedCreIds.join(',')})`)
  if (matchedBranchIds.size > 0) clauses.push(`branch_id.in.(${[...matchedBranchIds].join(',')})`)

  return query.or(clauses.join(',')) as Q
}

/**
 * Inclusive day window for a `YYYY-MM-DD` filter, as an IST instant range.
 *
 * The client sends the user's LOCAL calendar date and these are IST users, so `2026-08-06` must
 * mean 00:00–23:59:59.999 IST, not UTC. Reading it as UTC shifts the whole window 5h30m late:
 * "Today" would start at 05:30 IST and spill into tomorrow morning. IST has no DST, so the fixed
 * +05:30 offset is exact.
 *
 * These are for the ROW-LEVEL tables only (`call_log_entries.started_at`,
 * `call_recordings.recorded_at`) — real `timestamptz` columns that need an instant range.
 * `v_call_activity.day` is already a calendar date bucketed in the branch's own timezone
 * (`branches.timezone`, `Asia/Kolkata` for every branch today), so the view path filters it with a
 * plain `gte`/`lte` on the date and does no offset arithmetic at all. Do not "fix" the view path by
 * applying these.
 */
const IST_OFFSET = '+05:30'
export function istDayStart(date: string): string {
  return `${date}T00:00:00.000${IST_OFFSET}`
}
export function istDayEnd(date: string): string {
  return `${date}T23:59:59.999${IST_OFFSET}`
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * Page through a projection so PostgREST's silent row cap can never truncate a result.
 *
 * An unbounded `.select()` returns AT MOST `db-max-rows` (1000 on this project) and reports NO
 * error when it drops the rest — the query just looks like it found less data. Every read that can
 * exceed 1000 rows must go through here (or be replaced by a server-side aggregate). This is the
 * ONLY pager in the section; do not add a second one.
 */
export async function fetchAllPaged<T>(
  build: () => AnyQuery,
  pageSize = 1000,
  hardLimit = 100_000
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < hardLimit; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

// ── Call outcomes ──────────────────────────────────────────────────────────────────────────────
// Defined once, here, because the summary route, the call-list route and the raw fallback that
// mirrors `v_call_activity` all have to agree on them.

export const OUTCOME_ANSWERED = 'answered'
export const OUTCOME_MISSED = 'missed'
export const OUTCOME_NO_ANSWER = 'no_answer'
export const OUTCOME_REJECTED = 'rejected'
/** Deliberately in NEITHER the answered nor the unanswered bucket — see {@link ActivityRow}. */
export const OUTCOME_UNKNOWN = 'unknown'

/**
 * Every outcome the view counts as "unanswered".
 *
 * ⚠️ `rejected` belongs here. The earlier hand-rolled aggregate used only `missed` + `no_answer`
 * and therefore under-counted unanswered calls by every rejected call (1 of 912 when this was
 * checked, but that is a data accident, not a guarantee).
 */
export const UNANSWERED_OUTCOMES = [OUTCOME_MISSED, OUTCOME_NO_ANSWER, OUTCOME_REJECTED]

// ── v_call_activity ────────────────────────────────────────────────────────────────────────────

/** The backend's reporting view. Never aggregate `call_log_entries` by hand when this covers it. */
export const ACTIVITY_VIEW = 'v_call_activity'

/**
 * One row of `v_call_activity`: pre-aggregated call activity for one CRE, on one day, at one
 * branch. The backend owns it; this app only reads it.
 *
 * `day` is bucketed in the BRANCH'S OWN timezone (`branches.timezone`), which is why the view path
 * needs no IST arithmetic of its own.
 *
 * ⚠️ `total_attempts >= answered_calls + unanswered_calls`. The gap is `outcome = 'unknown'` —
 * calls the handset logged but could not classify. They are deliberately in neither bucket. Do NOT
 * reconcile the gap away by redefining one of the two; surface it as its own number
 * ("unclassified") so it stays visible if it ever grows.
 *
 * Likewise `outgoing_attempts >= outgoing_unanswered + (outgoing answered)`, so
 * `outgoing_attempts - outgoing_unanswered` is NOT a safe stand-in for "connected outgoing" — it
 * silently absorbs unknown outgoing calls. Where an exact direction × outcome split is needed, use
 * a `{ count: 'exact', head: true }` count on `call_log_entries` instead of deriving it.
 *
 * `answer_rate_pct` is a per-row percentage and CANNOT be averaged or summed across rows. Always
 * recompute it from the summed numerator and denominator.
 */
export type ActivityRow = {
  day: string
  cre_id: string | null
  branch_id: string | null
  cre_name: string | null
  total_attempts: number
  answered_calls: number
  unanswered_calls: number
  /** Incoming calls the CRE did not pick up. NOT the same as `unanswered_calls`. */
  missed_calls: number
  outgoing_attempts: number
  outgoing_unanswered: number
  incoming_attempts: number
  total_talk_time_seconds: number
  answer_rate_pct: number | null
  /** Calls that produced a recording row (`call_log_entries.recording_id is not null`). */
  recorded_calls: number
}

const ACTIVITY_COLUMNS =
  'day, cre_id, branch_id, cre_name, total_attempts, answered_calls, unanswered_calls, ' +
  'missed_calls, outgoing_attempts, outgoing_unanswered, incoming_attempts, ' +
  'total_talk_time_seconds, answer_rate_pct, recorded_calls'

export type ActivityFilters = {
  /** Inclusive `YYYY-MM-DD` calendar dates, compared directly against `v_call_activity.day`. */
  startDate: string | null
  endDate: string | null
  agent: string | null
  branchIds: string[] | null
}

/**
 * Read `v_call_activity` under the given filters, paged.
 *
 * The view is small per day (one row per CRE per branch bucket, ~17/day today) but a 90-day range
 * across a growing roster crosses 1000 rows easily, so it pages like everything else.
 */
export async function fetchActivityRows(
  filters: ActivityFilters,
  dir: CreDirectory
): Promise<ActivityRow[]> {
  const supabase = getCreSupabase()
  return fetchAllPaged<ActivityRow>(() => {
    let query = supabase.from(ACTIVITY_VIEW).select(ACTIVITY_COLUMNS) as unknown as AnyQuery
    if (filters.startDate) query = query.gte('day', filters.startDate)
    if (filters.endDate) query = query.lte('day', filters.endDate)
    if (filters.agent && filters.agent !== 'all') query = query.eq('cre_id', filters.agent)
    if (filters.branchIds) query = applyBranchScope(query, filters.branchIds, dir)
    // Stable ordering so paging cannot skip or repeat a row.
    return query.order('day', { ascending: true }).order('cre_id', { ascending: true })
  })
}

/** A raw `call_log_entries` row, narrowed to the columns the activity fold needs. */
export type RawLogRow = {
  cre_id: string | null
  branch_id: string | null
  direction: string | null
  outcome: string | null
  duration_seconds: number | null
  started_at: string | null
  recording_id: string | null
}

/**
 * Fold raw `call_log_entries` rows into the SAME shape `v_call_activity` returns.
 *
 * This exists for one case only: a free-text search. The view carries no `phone` or `contact_name`,
 * so a search has to match rows, and the section must not answer the same question two different
 * ways. Everything downstream aggregates {@link ActivityRow}s and neither knows nor cares which
 * path produced them.
 *
 * The classification here mirrors the view exactly — verified against the live data:
 * answered / unanswered (missed + no_answer + rejected) / `unknown` in neither.
 */
export function foldLogRowsToActivity(rows: RawLogRow[], dir: CreDirectory): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>()
  for (const r of rows) {
    if (!r.started_at) continue
    // Same IST calendar day the view would bucket into: every branch's timezone is Asia/Kolkata.
    const day = istCalendarDay(r.started_at)
    const key = `${day}|${r.cre_id ?? ''}|${r.branch_id ?? ''}`
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = {
        day,
        cre_id: r.cre_id,
        branch_id: r.branch_id,
        cre_name: r.cre_id ? dir.profileName.get(r.cre_id) ?? null : null,
        total_attempts: 0,
        answered_calls: 0,
        unanswered_calls: 0,
        missed_calls: 0,
        outgoing_attempts: 0,
        outgoing_unanswered: 0,
        incoming_attempts: 0,
        total_talk_time_seconds: 0,
        answer_rate_pct: null,
        recorded_calls: 0,
      }
      byKey.set(key, bucket)
    }
    const outcome = (r.outcome || '').toLowerCase()
    const direction = (r.direction || '').toLowerCase()
    const answered = outcome === OUTCOME_ANSWERED
    const unanswered = UNANSWERED_OUTCOMES.includes(outcome)

    bucket.total_attempts += 1
    if (answered) {
      bucket.answered_calls += 1
      bucket.total_talk_time_seconds += Number(r.duration_seconds) || 0
    }
    if (unanswered) bucket.unanswered_calls += 1
    if (direction === 'incoming') {
      bucket.incoming_attempts += 1
      // ⚠️ Use the SAME unanswered rule as every other bucket, not `outcome === 'missed'`.
      //
      // Counting only the literal 'missed' outcome made the dashboard contradict itself: the
      // "Missed Incoming" KPI read 13 while the Unanswered Numbers scorecard — which filters on
      // UNANSWERED_OUTCOMES — read 14 for the same range, and "28 incoming = 14 connected / 13
      // missed" did not add up. An incoming call the customer got no answer to, or that was
      // rejected, is a call the CRE did not pick up; the card's own subtitle says exactly that.
      if (unanswered) bucket.missed_calls += 1
    }
    if (direction === 'outgoing') {
      bucket.outgoing_attempts += 1
      if (unanswered) bucket.outgoing_unanswered += 1
    }
    if (r.recording_id) bucket.recorded_calls += 1
  }
  return [...byKey.values()]
}

/** `YYYY-MM-DD` for an instant, in IST — the timezone every branch in this project uses. */
export function istCalendarDay(instant: string): string {
  const t = new Date(instant).getTime()
  return new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Fetch and fold `call_recordings` into `ActivityRow` objects.
 *
 * Used as a fallback when `v_call_activity` or `call_log_entries` has 0 rows for a given branch or agent
 * (e.g. Special Team / Rupali CRM, whose handset syncs audio files to `call_recordings` rather than `call_log_entries`).
 */
export async function fetchRecordingsAsActivity(
  filters: ActivityFilters & { branchIds?: string[] | null; search?: string },
  dir: CreDirectory
): Promise<ActivityRow[]> {
  const supabase = getCreSupabase()
  let query = supabase.from('call_recordings').select('id, cre_id, branch_id, call_type, duration_seconds, recorded_at') as unknown as AnyQuery

  if (filters.startDate) query = query.gte('recorded_at', `${filters.startDate}T00:00:00+05:30`)
  if (filters.endDate) query = query.lte('recorded_at', `${filters.endDate}T23:59:59+05:30`)
  if (filters.agent && filters.agent !== 'all') query = query.eq('cre_id', filters.agent)
  if (filters.branchIds && filters.branchIds.length > 0) {
    const creIds = creIdsForBranches(filters.branchIds, dir)
    const clauses = [`branch_id.in.(${filters.branchIds.join(',')})`]
    if (creIds.length > 0) clauses.push(`cre_id.in.(${creIds.join(',')})`)
    query = query.or(clauses.join(','))
  }

  const recs = await fetchAllPaged<any>(() => query.order('recorded_at', { ascending: true }) as any)

  const byKey = new Map<string, ActivityRow>()
  for (const r of recs) {
    if (!r.recorded_at) continue
    const day = istCalendarDay(r.recorded_at)
    const key = `${day}|${r.cre_id ?? ''}|${r.branch_id ?? ''}`
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = {
        day,
        cre_id: r.cre_id,
        branch_id: r.branch_id,
        cre_name: r.cre_id ? dir.profileName.get(r.cre_id) ?? null : null,
        total_attempts: 0,
        answered_calls: 0,
        unanswered_calls: 0,
        missed_calls: 0,
        outgoing_attempts: 0,
        outgoing_unanswered: 0,
        incoming_attempts: 0,
        total_talk_time_seconds: 0,
        answer_rate_pct: null,
        recorded_calls: 0,
      }
      byKey.set(key, bucket)
    }

    const duration = Number(r.duration_seconds) || 0
    const callType = (r.call_type || '').toLowerCase()
    const isAnswered = duration > 0 || (callType !== 'missed' && callType !== 'no_answer' && callType !== 'rejected')

    bucket.total_attempts += 1
    if (isAnswered) {
      bucket.answered_calls += 1
    } else {
      bucket.unanswered_calls += 1
    }
    if (callType === 'missed') {
      bucket.missed_calls += 1
    }
    if (callType === 'outgoing') {
      bucket.outgoing_attempts += 1
      if (!isAnswered) bucket.outgoing_unanswered += 1
    } else if (callType === 'incoming' || callType === 'missed') {
      bucket.incoming_attempts += 1
    }
    bucket.total_talk_time_seconds += duration
    bucket.recorded_calls += 1
  }

  return Array.from(byKey.values())
}

/**
 * Postgres `distinct on (keys) order by <ts> desc` done in memory.
 *
 * `device_sync_health` is a TIME SERIES: reading it raw shows every heartbeat a handset ever sent
 * and makes a healthy fleet look broken. PostgREST cannot express DISTINCT ON, so the rows are
 * paged newest-first and the first occurrence of each key wins.
 */
export function distinctOnLatest<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const k = key(row)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }
  return out
}
