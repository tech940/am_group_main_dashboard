import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'
import {
  applyBranchScope,
  applySearch,
  branchLabel,
  istDayEnd,
  istDayStart,
  loadCreDirectory,
  resolveBranchId,
  resolveBranchScope,
  OUTCOME_ANSWERED,
  OUTCOME_MISSED,
  OUTCOME_NO_ANSWER,
  OUTCOME_REJECTED,
  UNANSWERED_OUTCOMES,
  UNASSIGNED_BRANCH_ID,
  resolveSpecialTeamBranchLabel,
  type CreDirectory,
} from '@/lib/cre-calls/directory'
import { resolvePreferredBrand } from '@/lib/cre-calls/brand-source'
import {
  lookupKey,
  matchCustomers,
  MATCH_SOURCE_LABEL,
  type CustomerMatch,
  type MatchSource,
  type PreferredBrand,
} from '@/lib/customer-identity/phone-match'
import { getExcludedNumbers } from '@/lib/customer-identity/exclusions'

export const dynamic = 'force-dynamic'

/**
 * AM Group CRE call log rows.
 *
 * Two real tables back this endpoint and the tab decides which one is authoritative:
 *
 *  - `call_log_entries` — the handset call log. Every call the CRE made or received, with
 *    `direction` and `outcome`. This is the only table that knows about unanswered calls, so it
 *    drives the default list and the Unanswered Numbers tab.
 *  - `call_recordings` — only calls that produced an audio file. It has `storage_path` for
 *    playback but no outcome column and never a zero duration, so it can only ever describe
 *    connected calls. It drives the Uploaded Recordings and Syncing tabs.
 *
 * This route previously merged in 94 hardcoded phone numbers with synthetic timestamps to populate
 * the unanswered tab. They were not real calls and have been removed; the tab now reads
 * `call_log_entries` where the outcome is one of {@link UNANSWERED_OUTCOMES}.
 *
 * ROW CAP: every read here is `.range()`d to one page of at most 100 rows, so PostgREST's silent
 * 1000-row truncation cannot reach it, and `total` comes from `count: 'exact'` rather than from
 * counting the returned array.
 *
 * PLAYBACK: `storage_path` points into the PRIVATE `recordings` bucket. This route returns NO
 * audio URL. The browser asks `/api/call-analysis/am-group/recordings/[id]/url` for a short-lived
 * signed URL when the user actually presses play — see that route for why.
 */

const BADGE_CONNECTED_OUT =
  'bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-primary)] border-[var(--dashboard-primary-border)]'
const BADGE_CONNECTED_IN = 'bg-emerald-50 text-emerald-700 border-emerald-200'
const BADGE_MISSED_IN = 'bg-rose-50 text-rose-700 border-rose-200'
const BADGE_NO_ANSWER = 'bg-amber-50 text-amber-700 border-amber-200'
const BADGE_UNKNOWN = 'bg-slate-100 text-slate-700 border-slate-200'

/**
 * `upload_status` values that mean "this recording is mid-sync", NOT "something is wrong".
 *
 * ⚠️ `pending` is NORMAL and TRANSIENT: the handset sweeps on roughly a 15-minute cycle and the
 * median recording is uploaded within ~10 minutes. Labelling it an error makes a healthy fleet look
 * broken. Only a `pending` row that is HOURS old is worth anyone's attention — see
 * `STALE_PENDING_HOURS` and the `isStale` flag below.
 */
const SYNCING_STATUSES = ['pending', 'uploading']
const STALE_PENDING_HOURS = 4

type EnrichedRow = {
  id: string
  phone: string
  contactName: string | null
  creId: string
  creName: string
  branchId: string
  branchName: string
  durationSeconds: number
  callType: string
  statusLabel: string
  statusBadgeClass: string
  recordedAt: string
  uploadStatus: string
  /** True when playback is possible: an `uploaded` row with an object behind it. */
  isPlayable: boolean
  /** `pending` / `uploading` that has been that way for longer than {@link STALE_PENDING_HOURS}. */
  isStaleSync: boolean
  deviceModel: string | null
  isMissedIncoming: boolean
  isMissedOutgoing: boolean
  isConnectedOutgoing: boolean
  isConnectedIncoming: boolean
  isUnanswered: boolean
  isConnectedLater?: boolean
  callbackTime?: string | null
  callbackCreName?: string | null
  callbackDelayLabel?: string | null
  /**
   * The digits we will look this number up by, or null when there is nothing lookupable.
   *
   * ⚠️ NEVER derive this from `phone`. derivePhoneAndName() falls back to the contact name and then
   * to the literal 'Saved Mobile Contact', so `phone` legitimately holds strings like
   * "Rajinder Kour". This is computed from the RAW column instead.
   */
  lookupPhone: string | null
  /** Who this number belongs to according to our own enquiry feeds. Null when we do not know. */
  customer: CustomerIdentity | null
  /** Set when the number is ours (staff / lead-routing trunk) rather than a customer's. */
  notACustomer: string | null
}

/** A customer identity resolved from our enquiry feeds — never from the handset address book. */
type CustomerIdentity = {
  name: string
  source: MatchSource
  sourceLabel: string
  model: string | null
  status: string | null
  consultant: string | null
  /** Date of the enquiry/booking behind this name, so the UI can show how old the evidence is. */
  refDate: string | null
  bookingNumber: string | null
  /**
   * True when this number resolves to more than one person across our feeds — a household line, a
   * dealer desk, or a recycled SIM. The name shown is then the best guess, not a fact.
   */
  isShared: boolean
}

/** Recover a phone number or contact name from a recording's file name when the column is empty. */
function derivePhoneAndName(row: any): { phone: string; contactName: string | null } {
  const fileName = row.file_name || ''
  let phone: string | null =
    row.phone && row.phone !== 'null' && row.phone !== 'Unknown Phone' ? String(row.phone) : null
  let contactName: string | null =
    row.contact_name && row.contact_name !== 'null' ? String(row.contact_name) : null

  if (!phone && fileName) {
    const parenMatch = fileName.match(/\(([+0-9]{10,14})\)/)
    if (parenMatch) {
      let p = parenMatch[1].replace(/^\+?0*/, '')
      if (p.length === 12 && p.startsWith('91')) p = p.slice(2)
      if (p.length >= 10) phone = p.slice(-10)
    }
  }

  if (!phone && fileName) {
    const numMatch = fileName.match(/(\b\d{10,12}\b)/)
    if (numMatch) {
      let p = numMatch[1]
      if (p.length === 12 && p.startsWith('91')) p = p.slice(2)
      if (p.length === 10) phone = p
    }
  }

  if (!contactName && fileName) {
    if (fileName.startsWith('Call recording ')) {
      const namePart = fileName
        .replace('Call recording ', '')
        .replace(/\.m4a|\.mp3|\.wav/gi, '')
        .split(/_\d{6}/)[0]
        .trim()
      if (namePart && !/^\+?\d+$/.test(namePart)) contactName = namePart.replace(/_/g, ' ').trim()
    } else if (fileName.includes('(')) {
      const namePart = fileName.split('(')[0].trim()
      if (namePart && !/^\d+$/.test(namePart)) contactName = namePart
    }
  }

  return { phone: phone || contactName || 'Saved Mobile Contact', contactName: contactName || null }
}

function describeLogRow(direction: string, outcome: string) {
  const isIncoming = direction === 'incoming'
  if (outcome === OUTCOME_ANSWERED) {
    return isIncoming
      ? { label: 'Connected Incoming', badge: BADGE_CONNECTED_IN, connIn: true, connOut: false, missIn: false, missOut: false }
      : { label: 'Connected Outgoing', badge: BADGE_CONNECTED_OUT, connIn: false, connOut: true, missIn: false, missOut: false }
  }
  if (outcome === OUTCOME_MISSED) {
    return isIncoming
      ? { label: 'Missed Incoming', badge: BADGE_MISSED_IN, connIn: false, connOut: false, missIn: true, missOut: false }
      : { label: 'Missed Outgoing', badge: BADGE_NO_ANSWER, connIn: false, connOut: false, missIn: false, missOut: true }
  }
  if (outcome === OUTCOME_REJECTED) {
    // A real outcome in this data. `v_call_activity` counts it as unanswered, so this list must
    // too — the earlier version recognised only `missed` / `no_answer` and dropped it.
    return isIncoming
      ? { label: 'Rejected (Incoming)', badge: BADGE_MISSED_IN, connIn: false, connOut: false, missIn: true, missOut: false }
      : { label: 'Rejected (Outgoing)', badge: BADGE_NO_ANSWER, connIn: false, connOut: false, missIn: false, missOut: true }
  }
  if (outcome === OUTCOME_NO_ANSWER) {
    return isIncoming
      ? { label: 'Not Answered (Incoming)', badge: BADGE_MISSED_IN, connIn: false, connOut: false, missIn: true, missOut: false }
      : { label: 'Not Answered (Outgoing)', badge: BADGE_NO_ANSWER, connIn: false, connOut: false, missIn: false, missOut: true }
  }
  // `unknown` — the handset logged the call but could not classify it. Neither connected nor
  // unanswered, and never presented as either.
  return { label: 'Unclassified', badge: BADGE_UNKNOWN, connIn: false, connOut: false, missIn: false, missOut: false }
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
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const agent = searchParams.get('agent')
  const branch = searchParams.get('branch')
  const callStatusFilter = searchParams.get('callStatus') || 'all'
  const search = (searchParams.get('search') || '').trim()
  const recordingsOnly = searchParams.get('recordingsOnly') === 'true'
  const pendingOnly = searchParams.get('pendingOnly') === 'true'
  const unansweredOnly = searchParams.get('unansweredOnly') === 'true'
  const unansweredType = searchParams.get('unansweredType') || (unansweredOnly ? 'incoming' : 'all')
  const missedIncomingOnly = searchParams.get('missedIncomingOnly') === 'true'
  const specialTeamOnly = searchParams.get('specialTeamOnly') === 'true'

  try {
    const supabase = getCreSupabase()
    const dir: CreDirectory = await loadCreDirectory()

    // A brand pill sends a slug ("kia", "am_group"), the sub-branch list sends a real uuid. Feeding
    // either straight into `.eq('branch_id', ...)` makes Postgres reject the query with
    // `invalid input syntax for type uuid` and 500s the whole tab, so both are resolved to ids here.
    const branchIds = resolveBranchScope(branch, dir)

    // The recording tabs and special team tab need `storage_path`, which only exists on `call_recordings`; everything
    // else is answered by the full call log.
    const useRecordingsTable = recordingsOnly || pendingOnly || specialTeamOnly
    const table = useRecordingsTable ? 'call_recordings' : 'call_log_entries'
    const dateColumn = useRecordingsTable ? 'recorded_at' : 'started_at'

    let query = supabase.from(table).select('*', { count: 'exact' })
    query = query.is('deleted_at', null)
    // The date params are the user's LOCAL (IST) calendar dates — see istDayStart.
    if (startDate) query = query.gte(dateColumn, istDayStart(startDate))
    if (endDate) query = query.lte(dateColumn, istDayEnd(endDate))
    if (agent && agent !== 'all') query = query.eq('cre_id', agent)

    if (specialTeamOnly) {
      const specialBranch = dir.branches.find(
        (b) => (b.code || '').toUpperCase() === 'SPECIAL' || (b.display_name || '').toLowerCase().includes('special team')
      )
      const specialBranchId = specialBranch?.id || '4d1d906b-6850-4a90-8309-e2ed9e61c6cb'
      const specialCreIds = dir.profiles.filter((p) => p.branch_id === specialBranchId).map((p) => p.id)
      const clauses = [`branch_id.eq.${specialBranchId}`]
      if (specialCreIds.length > 0) {
        clauses.push(`cre_id.in.(${specialCreIds.join(',')})`)
      }
      query = query.or(clauses.join(','))
    } else if (branchIds) {
      query = applyBranchScope(query, branchIds, dir)
    }

    if (search) query = applySearch(query, search, dir)

    // Every list predicate is pushed into SQL so that `total`, `totalPages` and the returned rows
    // are all derived from one query — they can never disagree.
    let impossibleFilter = false

    if (useRecordingsTable) {
      if (specialTeamOnly) {
        if (pendingOnly) {
          query = query.in('upload_status', [...SYNCING_STATUSES, 'failed'])
        } else {
          query = query.not('storage_path', 'is', null)
        }
      } else if (recordingsOnly) {
        // "Playable" means the object really exists in the private bucket. `upload_status` is the
        // authority on that: only `uploaded` rows may be signed, so only they belong in this tab.
        // Filtering on `storage_path is not null` alone also let `uploading` rows in, which sign to
        // an object that is not there yet.
        query = query.eq('upload_status', 'uploaded').not('storage_path', 'is', null).gt('duration_seconds', 0)
      } else {
        // Everything that has not landed yet: in-flight (`pending` / `uploading`) plus `failed`,
        // which would otherwise never surface anywhere in the UI. `pending` is not an error — the
        // client labels these by their real `upload_status`.
        query = query.in('upload_status', [...SYNCING_STATUSES, 'failed'])
      }

      // A recording only exists because audio was captured, so every row here is a connected call.
      // Asking this tab for missed calls is a contradiction and must return nothing rather than
      // silently ignoring the filter.
      if (unansweredOnly) impossibleFilter = true
      else if (callStatusFilter === 'connected_outgoing') query = query.neq('call_type', 'incoming')
      else if (callStatusFilter === 'connected_incoming') query = query.eq('call_type', 'incoming')
      else if (['missed_incoming', 'missed_outgoing', 'unanswered'].includes(callStatusFilter)) impossibleFilter = true
    } else {
      if (missedIncomingOnly || (unansweredOnly && unansweredType === 'incoming')) {
        query = query.eq('direction', 'incoming').in('outcome', UNANSWERED_OUTCOMES)
      } else if (unansweredOnly && unansweredType === 'outgoing') {
        query = query.eq('direction', 'outgoing').in('outcome', UNANSWERED_OUTCOMES)
      } else if (unansweredOnly) {
        query = query.in('outcome', UNANSWERED_OUTCOMES)
      } else if (callStatusFilter === 'connected_outgoing') query = query.eq('direction', 'outgoing').eq('outcome', OUTCOME_ANSWERED)
      else if (callStatusFilter === 'connected_incoming') query = query.eq('direction', 'incoming').eq('outcome', OUTCOME_ANSWERED)
      else if (callStatusFilter === 'missed_incoming') query = query.eq('direction', 'incoming').in('outcome', UNANSWERED_OUTCOMES)
      else if (callStatusFilter === 'missed_outgoing') query = query.eq('direction', 'outgoing').in('outcome', UNANSWERED_OUTCOMES)
      else if (callStatusFilter === 'unanswered') query = query.in('outcome', UNANSWERED_OUTCOMES)
    }

    if (impossibleFilter) {
      return NextResponse.json({
        rows: [],
        pagination: { page, pageSize, total: 0, totalPages: 1 },
      })
    }

    const { data: rawRows, error, count } = await query
      .order(dateColumn, { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (error) {
      throw new Error(`Failed to fetch call log: ${error.message}`)
    }

    const rows: EnrichedRow[] = (rawRows || []).map((row: any) => {
      const creId = row.cre_id || row.created_by || UNASSIGNED_BRANCH_ID
      const creName = dir.profileName.get(row.cre_id) || dir.profileName.get(row.created_by) || 'CRE Agent'
      // Canonical, so the branch column reads "AM Kia" whether the call was logged in Jammu or Udhampur.
      const branchId = resolveBranchId(row, dir)
      const branchName = branchLabel(branchId, dir, creId, creName)
      const durationSeconds = Number(row.duration_seconds) || 0
      const { phone, contactName } = derivePhoneAndName(row)
      // From the RAW column, deliberately — see EnrichedRow.lookupPhone.
      const lookupPhone = lookupKey(row.phone) || null

      if (useRecordingsTable) {
        const callType = (row.call_type || 'outgoing').toLowerCase()
        const isIncoming = callType === 'incoming'
        const uploadStatus = String(row.upload_status || 'uploaded')
        const recordedAt = row.recorded_at || row.created_at
        const ageHours = recordedAt
          ? (Date.now() - new Date(recordedAt).getTime()) / 3_600_000
          : 0
        return {
          id: row.id,
          phone,
          contactName,
          creId,
          creName,
          branchId: branchId || UNASSIGNED_BRANCH_ID,
          branchName,
          durationSeconds,
          callType: row.call_type || 'unknown',
          statusLabel: isIncoming ? 'Connected Incoming' : 'Connected Outgoing',
          statusBadgeClass: isIncoming ? BADGE_CONNECTED_IN : BADGE_CONNECTED_OUT,
          recordedAt,
          uploadStatus,
          // No URL and no `storage_path` in the payload. The bucket is private and the path is not
          // a capability — playback goes through the signing route, keyed by this row's id.
          isPlayable: uploadStatus === 'uploaded' && Boolean(row.storage_path),
          isStaleSync: SYNCING_STATUSES.includes(uploadStatus) && ageHours > STALE_PENDING_HOURS,
          deviceModel: row.device_model || null,
          isMissedIncoming: false,
          isMissedOutgoing: false,
          isConnectedOutgoing: !isIncoming,
          isConnectedIncoming: isIncoming,
          isUnanswered: false,
          lookupPhone,
          customer: null,
          notACustomer: null,
        }
      }

      const direction = (row.direction || 'outgoing').toLowerCase()
      const outcome = (row.outcome || OUTCOME_ANSWERED).toLowerCase()
      const desc = describeLogRow(direction, outcome)
      return {
        id: row.id,
        phone,
        contactName,
        creId,
        creName,
        branchId: branchId || UNASSIGNED_BRANCH_ID,
        branchName,
        durationSeconds,
        callType: direction,
        statusLabel: desc.label,
        statusBadgeClass: desc.badge,
        recordedAt: row.started_at || row.created_at,
        uploadStatus: row.recording_id ? 'uploaded' : 'no_recording',
        // A call-log row is never playable from this list: `call_log_entries` has no
        // `storage_path`, only a `recording_id` pointing at a row that may still be syncing.
        isPlayable: false,
        isStaleSync: false,
        deviceModel: row.device_model || null,
        isMissedIncoming: desc.missIn,
        isMissedOutgoing: desc.missOut,
        isConnectedOutgoing: desc.connOut,
        isConnectedIncoming: desc.connIn,
        isUnanswered: desc.missIn || desc.missOut,
        lookupPhone,
        customer: null,
        notACustomer: null,
      }
    })

    /*
     * ── Who is this number? ──────────────────────────────────────────────────────────────────
     *
     * The call data lives in the CRE Supabase project; the answer lives in OUR database. The two
     * cannot be joined, so the numbers are carried across in memory and resolved with one
     * set-based query here, AFTER paging — a page resolves only a few dozen distinct numbers.
     *
     * Never per row: this database is latency-bound (roughly two round trips per statement through
     * pgbouncer with prepare:false), so 25 lookups would cost 50 round trips to answer what one
     * query answers in two.
     *
     * Grouped by the CRE's brand because a number can exist in more than one brand's enquiry feed
     * and the CRE tells us which record to believe. In practice a page carries one or two brands,
     * so this is one or two queries, not one per row.
     *
     * Everything here is best-effort: a failure to reach our own database must leave the call log
     * working with no names, never 500 the tab.
     */
    const identifiable = rows.filter((r) => r.lookupPhone)
    if (identifiable.length > 0) {
      /*
       * The CRE's own brand decides which enquiry feed to believe when a number exists in more than
       * one — a Hyundai-service CRE's calls are about Hyundai. The special-team label is the ONLY
       * thing that separates the seven special-team CREs, who all share one branch whose brand reads
       * "Special Team", so "Special Branch (Kia sales)" is what makes Komal's calls resolve against
       * the KIA feed.
       */
      const preferenceFor = (row: EnrichedRow): PreferredBrand =>
        resolvePreferredBrand(
          resolveSpecialTeamBranchLabel(row.creId, row.creName),
          dir.branchBrand.get(row.branchId),
          row.branchName,
        )

      const requests = identifiable.map((row) => ({
        number: row.lookupPhone as string,
        preferBrand: preferenceFor(row),
      }))

      /*
       * Two statements, issued together — and that count is the whole design.
       *
       * Measured: the queries themselves run in 0.4-32 ms, but each statement costs ~350 ms of wall
       * time (pgbouncer, `prepare: false`, ~2 round trips). An earlier version grouped rows by brand
       * and issued one query per brand plus one for exclusions: five statements, 2.4 SECONDS on a
       * 50-row page, for ~35 ms of actual work. The preference now travels per number inside the
       * single match query instead.
       *
       * Both are best-effort. Failing to reach our own database must leave the call log working with
       * no names, never 500 the tab.
       */
      const [matches, excluded] = await Promise.all([
        matchCustomers(requests).catch(() => new Map<string, CustomerMatch>()),
        // Our own staff and the lead-routing trunks. Measured on this call log: 15 numbers are ours
        // and six of them ALSO match an enquiry row, so without this a call to a colleague renders a
        // confident customer identity — one of them resolves to our own company name.
        getExcludedNumbers(requests.map((r) => r.number)).catch(() => new Map()),
      ])

      for (const row of rows) {
        if (!row.lookupPhone) continue

        const exclusion = excluded.get(row.lookupPhone)
        if (exclusion) {
          // Say WHY there is no name rather than leaving a blank that reads like missing data.
          row.notACustomer = exclusion.label
          continue
        }

        const match = matches.get(row.lookupPhone)
        if (!match?.customerName) continue

        row.customer = {
          name: match.customerName,
          source: match.source,
          sourceLabel: MATCH_SOURCE_LABEL[match.source],
          model: match.model,
          status: match.status,
          consultant: match.consultant,
          refDate: match.refDate,
          bookingNumber: match.bookingNumber,
          isShared: match.distinctNames > 1,
        }
      }
    }

    // Enrich missed incoming call rows with callback recovery status
    const missedIncomingRows = rows.filter((r) => r.isMissedIncoming && r.phone)
    if (missedIncomingRows.length > 0) {
      const missedPhones = Array.from(new Set(missedIncomingRows.map((r) => r.phone)))
      const { data: answeredCalls } = await supabase
        .from('call_log_entries')
        .select('phone, started_at, cre_id')
        .is('deleted_at', null)
        .in('phone', missedPhones)
        .eq('outcome', OUTCOME_ANSWERED)
        .order('started_at', { ascending: true })

      for (const row of rows) {
        if (!row.isMissedIncoming || !row.phone) continue
        const missedTime = new Date(row.recordedAt).getTime()
        const subsequentAns = (answeredCalls || []).find(
          (a) => a.phone === row.phone && new Date(a.started_at).getTime() > missedTime
        )
        if (subsequentAns) {
          row.isConnectedLater = true
          const cbTime = new Date(subsequentAns.started_at).getTime()
          const diffMins = Math.max(1, Math.round((cbTime - missedTime) / 60000))
          const cbCreName = dir.profileName.get(subsequentAns.cre_id) || 'CRE Agent'
          row.callbackCreName = cbCreName
          row.callbackTime = subsequentAns.started_at

          let delayStr = `${diffMins}m`
          if (diffMins >= 1440) {
            delayStr = `${Math.round(diffMins / 1440)}d`
          } else if (diffMins >= 60) {
            delayStr = `${Math.round(diffMins / 60)}h`
          }
          row.callbackDelayLabel = `Connected in ${delayStr} (${cbCreName})`
        } else {
          row.isConnectedLater = false
          row.callbackDelayLabel = 'Still Remained Missing'
        }
      }
    }

    // No signing happens here. Bulk-signing a page of 20 URLs burns 20 storage calls whether or not
    // anyone presses play, and a short-lived URL minted at render time is already dead by the time
    // it is clicked. The client requests one on demand instead.
    const total = count ?? rows.length

    return NextResponse.json({
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[AM-Group-Call-Log] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load call log' },
      { status: 500 }
    )
  }
}
