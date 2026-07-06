'use client'

/* eslint-disable react-hooks/set-state-in-effect -- fetch effects set loading state on invocation; standard data-loading pattern used across the app. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
  User2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type ApprovalStage = 'ea_approval' | 'md_approval' | 'accounts'

type ApprovalRequest = {
  id: string
  requestNumber: string
  status: string
  stage: ApprovalStage | null
  requestedByName: string | null
  department: string | null
  purpose: string | null
  requestedAmount: string | number
  allocatedAmount: string | number | null
  categoryName: string | null
  branchId: string | null
  createdAt: string | null
  submittedAt: string | null
}

type HistoryItem = {
  id: string
  action: string
  stage: string | null
  remarks: string | null
  previousStatus: string | null
  newStatus: string | null
  performedByName: string
  createdAt: string | null
}

type RequestDetail = {
  request: ApprovalRequest & Record<string, unknown>
  allocation: Record<string, unknown> | null
  history: HistoryItem[]
}

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  ea_pending: { label: 'Awaiting EA', tone: 'amber' },
  ea_on_hold: { label: 'On Hold · EA', tone: 'amber' },
  md_pending: { label: 'Awaiting MD', tone: 'blue' },
  md_on_hold: { label: 'On Hold · MD', tone: 'blue' },
  accounts_pending: { label: 'Awaiting Accounts', tone: 'violet' },
  accounts_on_hold: { label: 'On Hold · Accounts', tone: 'violet' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
  ea_rejected: { label: 'Rejected · EA', tone: 'rose' },
  md_rejected: { label: 'Rejected · MD', tone: 'rose' },
}

type Tone = 'amber' | 'blue' | 'violet' | 'emerald' | 'rose' | 'slate'

const TONE_CLASS: Record<Tone, string> = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const STAGE_LABEL: Record<ApprovalStage, string> = {
  ea_approval: 'EA Approval',
  md_approval: 'MD Approval',
  accounts: 'Accounts',
}

function statusMeta(status: string) {
  return STATUS_META[status] || { label: status.replace(/_/g, ' '), tone: 'slate' as Tone }
}

function canActOnStage(role: string, stage: ApprovalStage | null) {
  if (role === 'super_admin') return true
  if (stage === 'ea_approval') return role === 'ea'
  if (stage === 'md_approval') return role === 'md' || role === 'eba'
  if (stage === 'accounts') return role === 'accounts'
  return false
}

function formatCurrency(value: string | number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatusPill({ status }: { status: string }) {
  const meta = statusMeta(status)
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset', TONE_CLASS[meta.tone])}>
      {meta.label}
    </span>
  )
}

export function PettyCashApprovalPanel({ role, userBrand, onCountChange }: { role: string; userBrand?: string; onCountChange?: (count: number) => void }) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  // MD/EBA review across all branches by default in the data, so give them a
  // My-Branch / All toggle (default My Branch), matching the PO approval page.
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const showScopeToggle = (role === 'md' || role === 'eba') && Boolean(userBrand) && userBrand !== 'all'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RequestDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [remarks, setRemarks] = useState('')
  const [approvedAmount, setApprovedAmount] = useState('')
  const [submitting, setSubmitting] = useState<null | 'approve' | 'hold' | 'reject'>(null)

  const onCountChangeRef = useRef(onCountChange)
  useEffect(() => { onCountChangeRef.current = onCountChange }, [onCountChange])

  // Debounce the search box
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if ((role === 'md' || role === 'eba') && userBrand && userBrand !== 'all' && scope === 'mine') {
        params.set('branchId', userBrand)
      }
      const res = await fetch(`/api/petty-cash/approvals?${params.toString()}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to load petty cash approvals')
      const rows: ApprovalRequest[] = data?.requests || []
      setRequests(rows)
      onCountChangeRef.current?.(typeof data?.count === 'number' ? data.count : rows.length)
    } catch (error) {
      toast({ title: 'Could not load petty cash approvals', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' })
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [search, role, userBrand, scope])

  useEffect(() => { void load() }, [load])

  const openDetail = useCallback(async (request: ApprovalRequest) => {
    setSelectedId(request.id)
    setDetail(null)
    setRemarks('')
    setApprovedAmount(String(request.allocatedAmount ?? request.requestedAmount ?? ''))
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/petty-cash/requests?id=${encodeURIComponent(request.id)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to load request')
      setDetail(data as RequestDetail)
    } catch (error) {
      toast({ title: 'Could not load request', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' })
      setSelectedId(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedId(null)
    setDetail(null)
  }, [])

  const activeRequest = useMemo(() => requests.find((request) => request.id === selectedId) || null, [requests, selectedId])
  const activeStage = (detail?.request?.stage as ApprovalStage | null | undefined) ?? activeRequest?.stage ?? null
  const canAct = canActOnStage(role, activeStage)

  const runAction = useCallback(async (action: 'approve' | 'hold' | 'reject') => {
    if (!selectedId || !activeStage) return
    if ((action === 'hold' || action === 'reject') && !remarks.trim()) {
      toast({ title: 'Remarks required', description: `Please add a remark before you ${action} this request.`, variant: 'error' })
      return
    }
    setSubmitting(action)
    try {
      const body: Record<string, unknown> = { action, stage: activeStage, remarks: remarks.trim() || undefined }
      if (action === 'approve' && activeStage === 'accounts' && approvedAmount) {
        body.allocatedAmount = Number(approvedAmount)
      }
      const res = await fetch(`/api/petty-cash/requests/${encodeURIComponent(selectedId)}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Failed to ${action} request`)
      toast({
        title: action === 'approve' ? 'Request approved' : action === 'hold' ? 'Request put on hold' : 'Request rejected',
        description: activeRequest?.requestNumber ? `${activeRequest.requestNumber} updated.` : 'The petty cash request was updated.',
        variant: action === 'reject' ? 'error' : 'success',
      })
      closeDetail()
      await load()
    } catch (error) {
      toast({ title: 'Action failed', description: error instanceof Error ? error.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(null)
    }
  }, [selectedId, activeStage, remarks, approvedAmount, activeRequest, closeDetail, load])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search request #, requester, purpose…"
            className="h-11 rounded-2xl border-slate-200 bg-white pl-10 font-semibold"
          />
        </div>
        <div className="flex items-center gap-2">
          {showScopeToggle && (
            <div className="inline-flex items-center gap-0.5 rounded-2xl border border-slate-200 bg-slate-100 p-0.5">
              {(['mine', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  className={cn('rounded-xl px-3 py-2 text-xs font-bold transition-colors', scope === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
                >
                  {value === 'mine' ? 'My Branch' : 'All Branches'}
                </button>
              ))}
            </div>
          )}
          <span className="text-sm font-semibold text-slate-500">
            {loading ? 'Loading…' : `${requests.length} pending`}
          </span>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 gap-2 rounded-2xl border-slate-200 font-bold">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {/* Table / cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`pc-skeleton-${index}`} className="h-[76px] animate-pulse rounded-2xl border border-slate-100 bg-slate-50" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-lg font-black text-slate-900">All caught up</h3>
          <p className="mt-1 max-w-sm text-sm font-medium text-slate-500">
            There are no petty cash requests waiting for your approval right now.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[1.3fr_1fr_0.9fr_0.8fr_1.1fr_auto] gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-500 lg:grid">
            <span>Request / Requester</span>
            <span>Purpose</span>
            <span>Department</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          <AnimatePresence initial={false}>
            {requests.map((request) => (
              <motion.button
                key={request.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                onClick={() => void openDetail(request)}
                className="grid w-full grid-cols-1 gap-2 border-b border-slate-100 px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-slate-50/70 lg:grid-cols-[1.3fr_1fr_0.9fr_0.8fr_1.1fr_auto] lg:items-center lg:gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs font-bold text-slate-500">{request.requestNumber}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm font-black text-slate-900">
                    <User2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{request.requestedByName || 'Unknown'}</span>
                  </div>
                </div>
                <div className="min-w-0 text-sm font-semibold text-slate-600">
                  <span className="line-clamp-2 lg:line-clamp-1">{request.purpose || '—'}</span>
                </div>
                <div className="text-sm font-semibold text-slate-600">{request.department || '—'}</div>
                <div className="text-sm font-black text-slate-900 lg:text-right">{formatCurrency(request.requestedAmount)}</div>
                <div><StatusPill status={request.status} /></div>
                <div className="flex items-center gap-1 text-sm font-bold text-[var(--dashboard-action-bg)] lg:justify-end">
                  Review <ArrowRight className="h-4 w-4" />
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Detail / action dialog */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) closeDetail() }}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden rounded-3xl border-0 p-0">
          <div className="flex max-h-[92dvh] flex-col">
            <DialogHeader className="space-y-3 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-bold text-slate-400">{activeRequest?.requestNumber || 'Petty Cash Request'}</span>
                {activeRequest && <StatusPill status={activeRequest.status} />}
              </div>
              <DialogTitle className="text-2xl font-black tracking-tight text-slate-950">
                {formatCurrency(activeRequest?.requestedAmount)}
              </DialogTitle>
              <DialogDescription className="text-sm font-semibold text-slate-500">
                {activeStage ? `${STAGE_LABEL[activeStage]} · ` : ''}{activeRequest?.requestedByName || 'Requester'}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              {detailLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={`detail-skeleton-${index}`} className="h-12 animate-pulse rounded-xl bg-slate-100" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <DetailField icon={User2} label="Requested By" value={activeRequest?.requestedByName || '—'} />
                    <DetailField icon={Building2} label="Department" value={activeRequest?.department || '—'} />
                    <DetailField icon={ClipboardList} label="Category" value={activeRequest?.categoryName || '—'} />
                    <DetailField icon={CalendarClock} label="Submitted" value={formatDate(activeRequest?.submittedAt || activeRequest?.createdAt)} />
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Purpose</p>
                    <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-700">{activeRequest?.purpose || '—'}</p>
                  </div>

                  {/* Timeline */}
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                      <Clock className="h-4 w-4 text-slate-400" /> Approval Timeline
                    </p>
                    {detail && detail.history.length > 0 ? (
                      <ol className="space-y-3 border-l-2 border-slate-100 pl-4">
                        {detail.history.map((item) => (
                          <li key={item.id} className="relative">
                            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[var(--dashboard-action-bg)] ring-2 ring-white" />
                            <p className="text-sm font-bold capitalize text-slate-800">{item.action.replace(/_/g, ' ')}</p>
                            <p className="text-xs font-semibold text-slate-500">{item.performedByName} · {formatDate(item.createdAt)}</p>
                            {item.remarks && <p className="mt-0.5 text-xs font-medium italic text-slate-500">“{item.remarks}”</p>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm font-medium text-slate-400">No history yet.</p>
                    )}
                  </div>

                  {/* Action area */}
                  {canAct && activeStage ? (
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                      {activeStage === 'accounts' && (
                        <div>
                          <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Approved Amount</label>
                          <div className="relative mt-1">
                            <Banknote className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              value={approvedAmount}
                              inputMode="numeric"
                              onChange={(event) => setApprovedAmount(event.target.value.replace(/[^\d.]/g, ''))}
                              className="h-11 rounded-xl border-slate-200 pl-9 font-bold"
                            />
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks {`(required to hold or reject)`}</label>
                        <Textarea
                          value={remarks}
                          onChange={(event) => setRemarks(event.target.value)}
                          placeholder="Add a note for this decision…"
                          className="mt-1 min-h-[72px] rounded-xl border-slate-200 font-medium"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Button
                          onClick={() => void runAction('approve')}
                          disabled={submitting !== null}
                          className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                        >
                          {submitting === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                        </Button>
                        <Button
                          onClick={() => void runAction('hold')}
                          disabled={submitting !== null}
                          variant="outline"
                          className="h-11 gap-2 rounded-xl border-amber-200 font-bold text-amber-700 hover:bg-amber-50"
                        >
                          {submitting === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />} Hold
                        </Button>
                        <Button
                          onClick={() => void runAction('reject')}
                          disabled={submitting !== null}
                          variant="outline"
                          className="h-11 gap-2 rounded-xl border-rose-200 font-bold text-rose-700 hover:bg-rose-50"
                        >
                          {submitting === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                      This request is at the {activeStage ? STAGE_LABEL[activeStage] : 'current'} stage and is not awaiting your action.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailField({ icon: Icon, label, value }: { icon: typeof User2; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}
