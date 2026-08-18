'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { Clock3, ClipboardList, Hourglass, RefreshCw, ShieldCheck, UserCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getBranchLabel } from '@/lib/branches'
import { toast } from '@/hooks/use-toast'
import {
  PETTY_CASH_STAGE_BUCKETS,
  formatWaitingDuration,
  getPettyCashStageBucket,
  getPettyCashStageInfo,
  type PettyCashStageBucket,
} from '@/lib/petty-cash/status-tracking'
import { EmptyState, RecordTable, SectionCard, StatusPill, SummaryCard, formatCurrency, formatDateTime, normalizeBranchId, normalizeRequestNumber, requestedAmount, requestedByName, type Tone, TONE_CLASS } from './pc-shared'
import type { PettyCashRequest } from './types'

type StatusBoardPayload = {
  generatedAt: string
  requests: PettyCashRequest[]
}

type StatusFilter = 'all' | PettyCashStageBucket

const BUCKET_TONE: Record<PettyCashStageBucket, Tone> = {
  'ED Approval': 'amber',
  'EA Approval': 'amber',
  'MD Approval': 'blue',
  Accounts: 'violet',
  Completed: 'emerald',
  Rejected: 'rose',
}

const BUCKET_ICON: Record<PettyCashStageBucket, typeof ShieldCheck> = {
  'ED Approval': UserCheck,
  'EA Approval': ShieldCheck,
  'MD Approval': UserCheck,
  Accounts: ClipboardList,
  Completed: ShieldCheck,
  Rejected: ClipboardList,
}

// Requests waiting longer than this at a single stage are highlighted as stale.
const STALE_WAIT_MS = 2 * 24 * 60 * 60 * 1000

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `Unable to load ${label}`)
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

export function PettyCashStatusBoard({ embedded = false }: { embedded?: boolean } = {}) {
  const [payload, setPayload] = useState<StatusBoardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  // Ticks every minute so the "time waiting" column stays live without a refetch.
  const [now, setNow] = useState(() => Date.now())
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async (options?: { preserveData?: boolean }) => {
    if (options?.preserveData) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchJson<StatusBoardPayload>('/api/petty-cash/status', 'petty cash status board')
      setPayload(data)
      setNow(Date.now())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load petty cash status board')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const handleDeleteRequest = async (requestId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (!confirm('Are you sure you want to delete this petty cash request?')) return
    setDeletingId(requestId)
    try {
      const res = await fetch(`/api/petty-cash/requests/${requestId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete request')
      await load({ preserveData: true })
    } catch (err) {
      // toast(), not alert(): the workspace reports this exact failure as a toast, and a native
      // modal for the same event on a sibling tab reads as a different, more serious kind of error.
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : 'Could not delete request', variant: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const canDeleteRequest = useCallback((request: PettyCashRequest) => {
    // Condition 1: Must be in a pending stage (not approved / completed / rejected)
    const stageInfo = getPettyCashStageInfo(request.status)
    const isPending = stageInfo.state === 'pending' || request.status === 'draft' || request.status === 'ed_pending' || request.status === 'ea_pending' || request.status === 'md_pending' || request.status === 'accounts_pending'
    if (!isPending) return false

    // Condition 2: Current user must be the submitter of the request (or developer/admin)
    const curUserId = (payload as any)?.currentUserId
    const curEmail = (payload as any)?.currentUserEmail?.toLowerCase()
    const curName = (payload as any)?.currentUserName?.toLowerCase()
    const curRole = (payload as any)?.currentUserRole

    if (curRole === 'developer' || curRole === 'super_admin') return true

    const reqCreatedBy = (request as any).createdBy || (request as any).created_by
    const reqEmail = ((request as any).requestedByEmail || (request as any).requested_by_email || '').toLowerCase()
    const reqName = (requestedByName(request) || '').toLowerCase()

    if (curUserId && reqCreatedBy && curUserId === reqCreatedBy) return true
    if (curEmail && reqEmail && curEmail === reqEmail) return true
    if (curName && reqName && curName === reqName) return true

    return false
  }, [payload])

  const requests = useMemo(() => payload?.requests ?? [], [payload])

  // Count per summary bucket.
  const bucketCounts = useMemo(() => {
    const counts: Record<PettyCashStageBucket, number> = {
      'ED Approval': 0,
      'EA Approval': 0,
      'MD Approval': 0,
      Accounts: 0,
      Completed: 0,
      Rejected: 0,
    }
    for (const request of requests) {
      const bucket = getPettyCashStageBucket(request.status)
      if (bucket) counts[bucket] += 1
    }
    return counts
  }, [requests])

  const pendingCount = bucketCounts['ED Approval'] + bucketCounts['EA Approval'] + bucketCounts['MD Approval'] + bucketCounts.Accounts

  const visibleRequests = useMemo(() => {
    const filtered = filter === 'all'
      ? requests
      : requests.filter((request) => getPettyCashStageBucket(request.status) === filter)

    // Pending items first, longest-waiting on top; terminal ones after, most recent first.
    return [...filtered].sort((a, b) => {
      const infoA = getPettyCashStageInfo(a.status)
      const infoB = getPettyCashStageInfo(b.status)
      const pendingA = infoA.state === 'pending'
      const pendingB = infoB.state === 'pending'
      if (pendingA !== pendingB) return pendingA ? -1 : 1
      const timeA = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0).getTime()
      const timeB = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0).getTime()
      return pendingA ? timeA - timeB : timeB - timeA
    })
  }, [requests, filter])

  if (loading && !payload) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={`status-kpi-skeleton-${index}`} className="h-36 animate-pulse motion-reduce:animate-none rounded-3xl bg-slate-100" />)}
        </div>
        <div className="h-96 animate-pulse motion-reduce:animate-none rounded-3xl bg-slate-100" />
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">
        {error || 'Unable to load the petty cash status board.'}
      </div>
    )
  }

  const refreshButton = (
    <Button
      variant="outline"
      onClick={() => void load({ preserveData: true })}
      disabled={refreshing}
      className={cn('gap-2 border-slate-200 font-bold', embedded ? 'h-9 rounded-xl text-xs' : 'h-11 rounded-2xl')}
    >
      <RefreshCw className={cn(embedded ? 'h-3.5 w-3.5' : 'h-4 w-4', refreshing && 'animate-spin')} /> Refresh
    </Button>
  )

  // This board renders standalone at /petty-cash/status as well as embedded in the workspace, so it
  // declares its own reduced-motion contract for the SummaryCard / DataTable primitives it borrows
  // from pc-shared.
  return (
    <MotionConfig reducedMotion="user">
    <div className="space-y-6">
      {/* Header — hidden when embedded as a workspace tab (the workspace supplies its own). */}
      {!embedded && (
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Approval Status Tracker</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Every petty cash request, its current stage, who it is waiting on, and how long it has been there.
            </p>
          </div>
          {refreshButton}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
      )}

      {/* Summary counts per stage */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Awaiting Action"
          value={String(pendingCount)}
          meta="Requests still in the approval chain"
          icon={Hourglass}
          tone="slate"
          onClick={() => setFilter('all')}
          active={filter === 'all'}
        />
        {PETTY_CASH_STAGE_BUCKETS.filter((bucket) => bucket !== 'Completed' && bucket !== 'Rejected').map((bucket) => (
          <SummaryCard
            key={bucket}
            label={bucket}
            value={String(bucketCounts[bucket])}
            meta={`Pending with ${bucket === 'Accounts' ? 'Accounts' : bucket.replace(' Approval', '')}`}
            icon={BUCKET_ICON[bucket]}
            tone={BUCKET_TONE[bucket]}
            onClick={() => setFilter(bucket)}
            active={filter === bucket}
          />
        ))}
      </div>

      {/* Terminal buckets as slim chips */}
      <div className="flex flex-wrap items-center gap-2">
        <StageChip label="All" count={requests.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        {PETTY_CASH_STAGE_BUCKETS.map((bucket) => (
          <StageChip
            key={bucket}
            label={bucket}
            count={bucketCounts[bucket]}
            active={filter === bucket}
            onClick={() => setFilter(bucket)}
          />
        ))}
      </div>

      <SectionCard
        title="Requests"
        subtitle="Pending requests first — longest waiting on top"
        icon={ClipboardList}
        iconTone="violet"
        toolbar={embedded ? refreshButton : undefined}
      >
        <RecordTable
          rows={visibleRequests}
          loading={refreshing}
          rowKey={(request) => request.id}
          empty={<EmptyState icon={ClipboardList} title="No requests" description="Petty cash requests will appear here once they are raised." />}
          columns={[
            {
              header: 'Request',
              cell: (request) => (
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-slate-500">{normalizeRequestNumber(request)}</span>
                  <span className="mt-0.5 font-bold text-slate-800">{requestedByName(request)}</span>
                  <span className="mt-0.5 line-clamp-1 max-w-[240px] text-xs font-medium text-slate-500">
                    {getBranchLabel(normalizeBranchId(request))} · {formatCurrency(requestedAmount(request))}
                  </span>
                </div>
              ),
            },
            {
              header: 'Current Stage',
              cell: (request) => (
                <div className="flex flex-col gap-1">
                  <span className="font-bold text-slate-800">{getPettyCashStageInfo(request.status).stageLabel}</span>
                  <StatusPill status={request.status} />
                </div>
              ),
            },
            {
              header: 'Pending Approver',
              cell: (request) => <ApproverBadge status={request.status} />,
            },
            {
              header: 'Time Waiting',
              align: 'right',
              cell: (request) => <WaitingCell request={request} now={now} />,
            },
            {
              header: 'Actions',
              align: 'right' as const,
              cell: (request) => {
                if (!canDeleteRequest(request)) return <span className="text-xs font-semibold text-slate-500">—</span>
                return (
                  <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => void handleDeleteRequest(request.id, e)}
                      disabled={deletingId === request.id}
                      title="Delete pending request"
                      className="flex h-11 sm:h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)] focus-visible:ring-offset-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                )
              },
            },
          ]}
        />
      </SectionCard>

      <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-500">
        <Clock3 className="h-3.5 w-3.5" />
        Time waiting is measured from the last stage change. Updated {formatDateTime(payload.generatedAt)}.
      </p>
    </div>
    </MotionConfig>
  )
}

function ApproverBadge({ status }: { status: string }) {
  const info = getPettyCashStageInfo(status)
  if (!info.approver) {
    return <span className="text-xs font-bold text-slate-500">—</span>
  }
  const tone: Tone = info.approver === 'EA' ? 'amber' : info.approver === 'MD' ? 'blue' : 'violet'
  // Third copy of the tone map, now deleted: it had no dark-mode treatment, so this badge stayed
  // light-on-light in dark mode exactly like the two before it. TONE_CLASS is the only source.
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset', TONE_CLASS[tone])}>
      <UserCheck className="h-3.5 w-3.5" /> {info.approver}
    </span>
  )
}

function WaitingCell({ request, now }: { request: PettyCashRequest; now: number }) {
  const info = getPettyCashStageInfo(request.status)
  if (info.state !== 'pending') {
    return <span className="text-xs font-bold text-slate-500">—</span>
  }
  const waitingSince = request.updatedAt || request.updated_at || request.createdAt || request.created_at || null
  const from = waitingSince ? new Date(waitingSince).getTime() : NaN
  const isStale = Number.isFinite(from) && now - from > STALE_WAIT_MS
  return (
    <span className={cn('font-black tabular-nums', isStale ? 'text-rose-600' : 'text-slate-800')}>
      {formatWaitingDuration(waitingSince, now)}
    </span>
  )
}

function StageChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
    >
      {label}
      <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-black', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>{count}</span>
    </button>
  )
}
