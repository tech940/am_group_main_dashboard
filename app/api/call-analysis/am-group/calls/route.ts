import { NextResponse } from 'next/server'
import { requireCallAnalysisApi } from '@/lib/call-analysis/access'
import { getCreSupabase } from '@/lib/cre-calls/cre-supabase'
import {
  applyBranchScope,
  applyViewBranchScope,
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
 * Primary source is the PostgreSQL view `v_calls_with_numbers` which adds resolved CRE numbers,
 * caller numbers, directions, and recording status.
 *
 * Only transient syncing records (`pendingOnly`) query `call_recordings` directly.
 */

const BADGE_CONNECTED_OUT =
  'bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-primary)] border-[var(--dashboard-primary-border)]'
const BADGE_CONNECTED_IN = 'bg-emerald-50 text-emerald-700 border-emerald-200'
const BADGE_MISSED_IN = 'bg-rose-50 text-rose-700 border-rose-200'
const BADGE_NO_ANSWER = 'bg-amber-50 text-amber-700 border-amber-200'
const BADGE_UNKNOWN = 'bg-slate-100 text-slate-700 border-slate-200'

const SYNCING_STATUSES = ['pending', 'uploading']
const STALE_PENDING_HOURS = 4

export type EnrichedRow = {
  id: string
  phone: string
  contactName: string | null
  fromNumber: string | null
  toNumber: string | null
  creNumber: string | null
  creNumberSource: 'sim' | 'single' | 'assumed' | null
  customerNumber: string | null
  customerName: string | null
  recordingId: string | null
  hasRecording: boolean
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
  /** True when playback is possible */
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
  lookupPhone: string | null
  customer: CustomerIdentity | null
  notACustomer: string | null
}

/** A customer identity resolved from our enquiry feeds — never from the handset address book. */
export type CustomerIdentity = {
  name: string
  source: MatchSource
  sourceLabel: string
  model: string | null
  status: string | null
  consultant: string | null
  refDate: string | null
  bookingNumber: string | null
  isShared: boolean
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
    return isIncoming
      ? { label: 'Rejected (Incoming)', badge: BADGE_MISSED_IN, connIn: false, connOut: false, missIn: true, missOut: false }
      : { label: 'Rejected (Outgoing)', badge: BADGE_NO_ANSWER, connIn: false, connOut: false, missIn: false, missOut: true }
  }
  if (outcome === OUTCOME_NO_ANSWER) {
    return isIncoming
      ? { label: 'Not Answered (Incoming)', badge: BADGE_MISSED_IN, connIn: false, connOut: false, missIn: true, missOut: false }
      : { label: 'Not Answered (Outgoing)', badge: BADGE_NO_ANSWER, connIn: false, connOut: false, missIn: false, missOut: true }
  }
  return { label: 'Unclassified', badge: BADGE_UNKNOWN, connIn: false, connOut: false, missIn: false, missOut: false }
}

export async function GET(request: Request) {
  // Same rule as the page: a Call Analysis role, or an explicit call_analysis.view grant.
  const access = await requireCallAnalysisApi()
  if ('denied' in access) return access.denied

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
    const branchIds = resolveBranchScope(branch, dir)

    // For pending uploads still on handset/syncing, use call_recordings.
    // For everything else, use the PostgreSQL view v_calls_with_numbers.
    const useRecordingsTable = pendingOnly
    const table = useRecordingsTable ? 'call_recordings' : 'v_calls_with_numbers'
    const dateColumn = useRecordingsTable ? 'recorded_at' : 'started_at'

    let query = supabase.from(table).select('*', { count: 'exact' })
    if (useRecordingsTable) {
      query = query.is('deleted_at', null)
    }

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
      if (!useRecordingsTable) {
        query = query.in('cre_id', specialCreIds)
      } else {
        query = query.or(clauses.join(','))
      }
    } else if (branchIds) {
      if (!useRecordingsTable) {
        query = applyViewBranchScope(query, branchIds, dir)
      } else {
        query = applyBranchScope(query, branchIds, dir)
      }
    }

    if (search) {
      query = applySearch(query, search, dir, useRecordingsTable ? 'recordings' : 'view')
    }

    let impossibleFilter = false

    if (useRecordingsTable) {
      query = query.in('upload_status', [...SYNCING_STATUSES, 'failed'])
      if (unansweredOnly || ['missed_incoming', 'missed_outgoing', 'unanswered'].includes(callStatusFilter)) {
        impossibleFilter = true
      }
    } else {
      if (recordingsOnly) {
        query = query.eq('has_recording', true).not('recording_id', 'is', null).gt('duration_seconds', 0)
        if (unansweredOnly) impossibleFilter = true
        else if (callStatusFilter === 'connected_outgoing') query = query.eq('direction', 'outgoing')
        else if (callStatusFilter === 'connected_incoming') query = query.eq('direction', 'incoming')
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
      const creName = row.cre_name || dir.profileName.get(row.cre_id) || dir.profileName.get(row.created_by) || 'CRE Agent'
      const branchId = resolveBranchId(row, dir)
      const branchName = row.branch_name || row.branch_label || branchLabel(branchId, dir, creId, creName)
      const durationSeconds = Number(row.duration_seconds) || 0

      if (useRecordingsTable) {
        const callType = (row.call_type || 'outgoing').toLowerCase()
        const isIncoming = callType === 'incoming'
        const uploadStatus = String(row.upload_status || 'pending')
        const recordedAt = row.recorded_at || row.created_at
        const ageHours = recordedAt
          ? (Date.now() - new Date(recordedAt).getTime()) / 3_600_000
          : 0
        const phone = row.phone || 'Unknown'
        const contactName = row.contact_name || null
        const lookupPhone = lookupKey(phone) || null

        return {
          id: row.id,
          phone,
          contactName,
          fromNumber: isIncoming ? phone : null,
          toNumber: isIncoming ? null : phone,
          creNumber: null,
          creNumberSource: null,
          customerNumber: phone,
          customerName: contactName,
          recordingId: row.id,
          hasRecording: true,
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

      const fromNumber = row.from_number || null
      const toNumber = row.to_number || null
      const creNumber = row.cre_number || null
      const creNumberSource = (row.cre_number_source as 'sim' | 'single' | 'assumed') || null
      const customerNumber = row.customer_number || (direction === 'incoming' ? fromNumber : toNumber) || null
      const customerName = row.customer_name || null
      const recordingId = row.recording_id || null
      const hasRecording = Boolean(row.has_recording && recordingId)

      const phone = customerNumber || toNumber || fromNumber || 'Unknown'
      const contactName = customerName || null
      const lookupPhone = lookupKey(customerNumber || phone) || null

      return {
        id: row.id,
        phone,
        contactName,
        fromNumber,
        toNumber,
        creNumber,
        creNumberSource,
        customerNumber,
        customerName,
        recordingId,
        hasRecording,
        creId,
        creName,
        branchId: branchId || UNASSIGNED_BRANCH_ID,
        branchName,
        durationSeconds,
        callType: direction,
        statusLabel: desc.label,
        statusBadgeClass: desc.badge,
        recordedAt: row.started_at || row.created_at,
        uploadStatus: hasRecording ? 'uploaded' : 'no_recording',
        isPlayable: hasRecording,
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
     */
    const identifiable = rows.filter((r) => r.lookupPhone)
    if (identifiable.length > 0) {
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

      const [matches, excluded] = await Promise.all([
        matchCustomers(requests).catch(() => new Map<string, CustomerMatch>()),
        getExcludedNumbers(requests.map((r) => r.number)).catch(() => new Map()),
      ])

      for (const row of rows) {
        if (!row.lookupPhone) continue

        const exclusion = excluded.get(row.lookupPhone)
        if (exclusion) {
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
    const missedIncomingRows = rows.filter((r) => r.isMissedIncoming && (r.customerNumber || r.fromNumber || r.phone))
    if (missedIncomingRows.length > 0) {
      const { data: answeredCalls } = await supabase
        .from('v_calls_with_numbers')
        .select('customer_number, from_number, to_number, started_at, cre_id, cre_name')
        .eq('outcome', OUTCOME_ANSWERED)
        .order('started_at', { ascending: true })

      for (const row of rows) {
        if (!row.isMissedIncoming) continue
        const rowKey = lookupKey(row.customerNumber || row.fromNumber || row.phone)
        if (!rowKey) continue
        const missedTime = new Date(row.recordedAt).getTime()
        const subsequentAns = (answeredCalls || []).find(
          (a) =>
            (lookupKey(a.customer_number) === rowKey ||
              lookupKey(a.from_number) === rowKey ||
              lookupKey(a.to_number) === rowKey) &&
            new Date(a.started_at).getTime() > missedTime
        )
        if (subsequentAns) {
          row.isConnectedLater = true
          const cbTime = new Date(subsequentAns.started_at).getTime()
          const diffMins = Math.max(1, Math.round((cbTime - missedTime) / 60000))
          const cbCreName = subsequentAns.cre_name || dir.profileName.get(subsequentAns.cre_id) || 'CRE Agent'
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
