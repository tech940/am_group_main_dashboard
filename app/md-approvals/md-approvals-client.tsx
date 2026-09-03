'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownUp,
  Building2,
  Check,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  Inbox,
  Loader2,
  Paperclip,
  PauseCircle,
  RefreshCw,
  Search,
  Square,
  SquareCheck,
  X,
} from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatIndiaDate } from '@/lib/date-time'
import type {
  AmountKind,
  MdApprovalRow,
  MdApprovalSourceId,
  MdApprovalSummary,
} from '@/lib/md-approvals/sources'

/**
 * ONE client for every approval source. The registry in `lib/md-approvals/sources.ts` decides what a
 * source is; nothing here is per-source except what the payload declares (`supportsHold`,
 * `amountKind`, `href`). A fourth source is a registry entry, not a change to this file.
 *
 * ⚠️ This screen never decides an outcome itself. Every button posts to
 * `/api/md-approvals/{source}/action`, which re-issues the request to the module's own endpoint. That
 * means a batch can PARTIALLY succeed, so the response is read row by row and failures are rendered
 * as a persistent panel — a blanket "done" toast over a half-failed batch is the exact way money
 * silently stops moving.
 */

/* ------------------------------------------------------------------ types mirroring the API */

type SourceMeta = {
  id: MdApprovalSourceId
  label: string
  href: string
  amountKind: AmountKind
  supportsHold: boolean
}

type MdApprovalPayload = {
  source: SourceMeta
  summary: MdApprovalSummary
  rows: MdApprovalRow[]
}

type ActionKind = 'approve' | 'reject' | 'hold'
type RemarkAction = Exclude<ActionKind, 'approve'>

/** Default is oldest — this is a work queue, and the thing that hurts is the request nobody saw. */
type SortOrder = 'oldest' | 'newest'

type RowResult = { id: string; ok: boolean; error?: string }
type ActionResponse = { ok: boolean; processed: number; failed: number; results: RowResult[] }

type Failure = { id: string; reference: string; error: string }

/* ------------------------------------------------------------------ constants */

const SOURCE_IDS: MdApprovalSourceId[] = ['purchase_orders', 'petty_cash', 'vendor_payments']

const SOURCE_FALLBACK_LABEL: Record<MdApprovalSourceId, string> = {
  purchase_orders: 'Purchase Orders',
  petty_cash: 'Petty Cash',
  vendor_payments: 'Vendor Payments',
}

const ACTION_PAST: Record<ActionKind, string> = {
  approve: 'approved',
  reject: 'rejected',
  hold: 'put on hold',
}

/** Tropical Navy on white. The header banner is the only filled surface on the page. */
const HEADER_BANNER: React.CSSProperties = {
  background: 'linear-gradient(135deg, var(--dashboard-primary) 0%, var(--dashboard-primary-dark) 100%)',
}

const CARD = 'bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs'
const CONTROL =
  'h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]'

/* ------------------------------------------------------------------ formatting */

const inr = (n: number) => {
  const hasPaise = Math.round(n * 100) % 100 !== 0
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

/** Whole days a row has been sitting. Null when the source gave us no timestamp. */
function daysWaiting(createdAt: string | null): number | null {
  if (!createdAt) return null
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

// IST, explicitly. 'en-IN' alone is a language, not a timezone — see lib/date-time.ts.
const formatDate = (createdAt: string | null): string => formatIndiaDate(createdAt)

/**
 * ⚠️ A null `amount` is NOT zero — purchase orders have no number until GRN, long after the MD has
 * decided. Fall through to the free-text estimate rather than printing ₹0.
 */
function amountDisplay(row: MdApprovalRow): string {
  if (row.amount !== null && row.amount !== undefined && row.amount > 0) return inr(row.amount)
  // `amountText` is the purchase-order `estimate_if_any` — a FREE-TEXT field. When it is purely a
  // number it is money and should read as money; when it is prose ("approx 5k, 3 vendors quoted")
  // it is shown verbatim, because "₹approx 5k" would be nonsense.
  if (row.amountText) {
    const numeric = Number(row.amountText.replace(/[,\s₹]/g, ''))
    if (row.amountText.trim() !== '' && Number.isFinite(numeric) && numeric > 0) {
      return inr(numeric)
    }
    return row.amountText
  }
  if (row.amount !== null && row.amount !== undefined) return inr(row.amount)
  return '—'
}

/** Milliseconds, or null when the source gave us nothing parseable. */
function timestamp(createdAt: string | null): number | null {
  if (!createdAt) return null
  const t = Date.parse(createdAt)
  return Number.isFinite(t) ? t : null
}

/**
 * ⚠️ A row with no timestamp sorts LAST in BOTH directions. It is missing data, not "ancient" or
 * "brand new" — letting it head the queue under either sort would put the wrong thing in front of
 * the MD.
 */
function compareByCreatedAt(a: MdApprovalRow, b: MdApprovalRow, order: SortOrder): number {
  const at = timestamp(a.createdAt)
  const bt = timestamp(b.createdAt)
  if (at === null && bt === null) return 0
  if (at === null) return 1
  if (bt === null) return -1
  return order === 'oldest' ? at - bt : bt - at
}

/** True when the URL looks like something a browser will render inline as an image. */
function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i.test(url)
}

/** Last path segment, for labelling an attachment the MD has not opened yet. */
function fileNameOf(url: string, index: number): string {
  const raw = url.split(/[?#]/)[0].split('/').pop() || ''
  if (!raw) return `Attachment ${index + 1}`
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function fetchSource(id: MdApprovalSourceId): Promise<MdApprovalPayload> {
  const res = await fetch(`/api/md-approvals/${id}`, { cache: 'no-store' })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new Error(
      (payload?.error as string) || `Failed to load ${SOURCE_FALLBACK_LABEL[id]} (${res.status})`,
    )
  }
  return res.json()
}

/* ------------------------------------------------------------------ component */

export function MdApprovalsClient() {
  const queryClient = useQueryClient()

  const [activeId, setActiveId] = useState<MdApprovalSourceId>('purchase_orders')
  const [scope, setScope] = useState<'awaiting' | 'all'>('awaiting')
  const [sortOrder, setSortOrder] = useState<SortOrder>('oldest')
  const [branch, setBranch] = useState('all')
  const [dealership, setDealership] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  /**
   * The details dialog tracks an ID, not a row snapshot, so it re-reads from the live query. When an
   * approval from inside the dialog moves the row out of the queue the dialog closes on its own
   * instead of sitting there showing a stage that is no longer true.
   */
  const [detailsId, setDetailsId] = useState<string | null>(null)
  /** Ids with a request in flight — their own buttons go dead so a double click can't double-post. */
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [failures, setFailures] = useState<Failure[] | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ action: RemarkAction; ids: string[] } | null>(null)
  const [remarks, setRemarks] = useState('')

  // All three load in parallel — the tab badges must be right before the MD picks a tab.
  const purchaseOrders = useQuery<MdApprovalPayload, Error>({
    queryKey: ['md-approvals', 'purchase_orders'],
    queryFn: () => fetchSource('purchase_orders'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const pettyCash = useQuery<MdApprovalPayload, Error>({
    queryKey: ['md-approvals', 'petty_cash'],
    queryFn: () => fetchSource('petty_cash'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const vendorPayments = useQuery<MdApprovalPayload, Error>({
    queryKey: ['md-approvals', 'vendor_payments'],
    queryFn: () => fetchSource('vendor_payments'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const queries: Record<MdApprovalSourceId, UseQueryResult<MdApprovalPayload, Error>> = {
    purchase_orders: purchaseOrders,
    petty_cash: pettyCash,
    vendor_payments: vendorPayments,
  }

  const active = queries[activeId]
  const source = active.data?.source
  const summary = active.data?.summary
  const activeData = active.data
  const allRows = useMemo(() => activeData?.rows ?? [], [activeData])

  const totalAwaiting = SOURCE_IDS.reduce(
    (sum, id) => sum + (queries[id].data?.summary.awaitingMd ?? 0),
    0,
  )
  const anyLoading = SOURCE_IDS.some((id) => queries[id].isLoading)
  const loadErrors = SOURCE_IDS
    .map((id) => ({ id, error: queries[id].error }))
    .filter((e): e is { id: MdApprovalSourceId; error: Error } => Boolean(e.error))

  /** Only offered when the source actually carries one — an empty dropdown is a dead control. */
  const dealershipOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of allRows) if (row.dealership) set.add(row.dealership)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [allRows])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return allRows
      .filter((row) => {
        if (scope === 'awaiting' && !row.awaitingMd) return false
        if (branch !== 'all' && (row.branch || 'unassigned') !== branch) return false
        if (dealership !== 'all' && (row.dealership || '') !== dealership) return false
        if (!term) return true
        return `${row.reference} ${row.title} ${row.requestedBy || ''}`.toLowerCase().includes(term)
      })
      .sort((a, b) => compareByCreatedAt(a, b, sortOrder))
  }, [allRows, scope, branch, dealership, search, sortOrder])

  const selectableIds = useMemo(
    () => visibleRows.filter((row) => row.awaitingMd).map((row) => row.id),
    [visibleRows],
  )

  // A row that scrolls out of the filter must not stay silently selected — the bulk bar would act on
  // something the MD can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => selectableIds.includes(id))
      return next.length === prev.length ? prev : next
    })
  }, [selectableIds])

  const awaitingRows = useMemo(() => allRows.filter((row) => row.awaitingMd), [allRows])
  const ageSeries = useMemo(() => {
    const ages = awaitingRows
      .map((row) => daysWaiting(row.createdAt))
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b)
    return ages.length ? ages.slice(-24) : [0]
  }, [awaitingRows])
  const oldestDays = ageSeries.length ? ageSeries[ageSeries.length - 1] : 0
  const oldestRow = useMemo(() => {
    let best: MdApprovalRow | null = null
    for (const row of awaitingRows) {
      if (!row.createdAt) continue
      if (!best || (timestamp(row.createdAt) ?? Infinity) < (timestamp(best.createdAt) ?? Infinity)) {
        best = row
      }
    }
    return best
  }, [awaitingRows])

  /** Re-read from the live rows so the dialog reflects the latest fetch, not a stale snapshot. */
  const detailsRow = useMemo(
    () => allRows.find((row) => row.id === detailsId) ?? null,
    [allRows, detailsId],
  )

  const branchSeries = useMemo(() => {
    const series = (summary?.branches ?? []).map((b) => b.awaitingMd)
    return series.length ? series : [0]
  }, [summary])
  const valueSeries = useMemo(() => {
    const series = awaitingRows
      .map((row) => row.amount)
      .filter((a): a is number => a !== null && a !== undefined)
    return series.length ? series.slice(-24) : [0]
  }, [awaitingRows])
  const branchesAffected = (summary?.branches ?? []).filter((b) => b.awaitingMd > 0).length

  /* ---------------------------------------------------------------- actions */

  const runAction = useCallback(
    async (action: ActionKind, ids: string[], note: string) => {
      if (!ids.length) return
      setFailures(null)
      setSuccess(null)
      setPendingIds((prev) => [...new Set([...prev, ...ids])])

      const reference = new Map(allRows.map((row) => [row.id, row.reference]))
      let response: ActionResponse | null = null
      let hardError: string | null = null

      try {
        const res = await fetch(`/api/md-approvals/${activeId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, action, remarks: note }),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) hardError = (payload?.error as string) || `Request failed (${res.status})`
        else response = payload as ActionResponse
      } catch (err) {
        hardError = err instanceof Error ? err.message : 'The request never reached the server.'
      }

      if (hardError) {
        // Nothing was attributable to a row, so every id in the batch is reported as failed rather
        // than leaving the MD to guess which ones went through.
        const message = hardError
        setFailures(ids.map((id) => ({ id, reference: reference.get(id) || id, error: message })))
      } else if (response) {
        const failed = (response.results || []).filter((r) => !r.ok)
        if (failed.length) {
          setFailures(
            failed.map((r) => ({
              id: r.id,
              reference: reference.get(r.id) || r.id,
              error: r.error || 'Failed without a reason from the module.',
            })),
          )
        }
        if (response.processed > 0) {
          setSuccess(`${response.processed} ${ACTION_PAST[action]}`)
        }
        setSelected((prev) => prev.filter((id) => !ids.includes(id)))
      }

      setPendingIds((prev) => prev.filter((id) => !ids.includes(id)))
      // Always re-read. The module endpoints are the source of truth and a hold or a chain rule may
      // have moved a row somewhere this screen did not predict.
      await queryClient.invalidateQueries({ queryKey: ['md-approvals'] })
    },
    [activeId, allRows, queryClient],
  )

  function openRemarkDialog(action: RemarkAction, ids: string[]) {
    if (!ids.length) return
    setRemarks('')
    setDialog({ action, ids })
  }

  function confirmRemarkDialog() {
    if (!dialog) return
    const note = remarks.trim()
    // The API returns 400 on a reasonless rejection; the button is dead long before that.
    if (dialog.action === 'reject' && !note) return
    const { action, ids } = dialog
    setDialog(null)
    setRemarks('')
    void runAction(action, ids, note)
  }

  function changeSource(id: MdApprovalSourceId) {
    if (id === activeId) return
    setActiveId(id)
    // Branch and dealership vocabularies differ per source — carrying them over silently empties the
    // table and looks like "there is nothing to approve".
    setBranch('all')
    setDealership('all')
    setSearch('')
    setSelected([])
    setFailures(null)
    setSuccess(null)
  }

  function toggleSelectAll() {
    setSelected((prev) => (selectableIds.every((id) => prev.includes(id)) && selectableIds.length ? [] : selectableIds))
  }

  /**
   * Selection is driven by clicking the row itself. Only rows the MD can actually act on are
   * selectable, and a row with a request already in flight is left alone so a stray click cannot
   * fold it into the next batch.
   */
  function toggleRow(row: MdApprovalRow) {
    if (!row.awaitingMd || pendingIds.includes(row.id)) return
    setSelected((prev) =>
      prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id],
    )
  }

  /** Enter and Space toggle, matching the row's `role="button"`. Space must not scroll the page. */
  function onRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, row: MdApprovalRow) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    event.preventDefault()
    toggleRow(row)
  }

  function exportCsv() {
    const header = ['Reference', 'Request', 'Requested by', 'Branch', 'Dealership', 'Amount', 'Raised on', 'Days waiting', 'Stage']
    const body = visibleRows.map((row) => [
      row.reference,
      row.title,
      row.requestedBy || '',
      row.branchLabel,
      row.dealership || '',
      amountDisplay(row),
      formatDate(row.createdAt),
      daysWaiting(row.createdAt) ?? '',
      row.stageLabel,
    ])
    const csv = [header, ...body]
      .map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `md-approvals-${activeId}-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // The per-row checkbox column is gone — clicking the row selects it.
  const columnCount = 7
  const busySelection = selected.some((id) => pendingIds.includes(id))
  const dialogInvalid = dialog?.action === 'reject' && !remarks.trim()
  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id))
  const detailsBusy = detailsRow ? pendingIds.includes(detailsRow.id) : false

  /* ---------------------------------------------------------------- render */

  return (
    <MainLayout title="MD Approvals" subtitle="Everything waiting on your approval, in one place">
      <div className="space-y-5 pb-4">
        {/* ---- headline ---- */}
        <div className={cn(CARD, 'flex flex-wrap items-center justify-between gap-4')}>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(var(--dashboard-primary-rgb),0.08)] text-[var(--dashboard-primary)]">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                Waiting on you
              </p>
              <p className="text-3xl font-black leading-none text-[var(--dashboard-primary)]">
                {anyLoading ? '—' : totalAwaiting.toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                across {SOURCE_IDS.length} modules · purchase orders, petty cash and vendor payments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {source && (
              <a
                href={source.href}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-[var(--dashboard-primary)] transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open {source.label}
              </a>
            )}
            <Button
              variant="outline"
              className="h-10 gap-1.5 rounded-xl text-xs font-bold focus:ring-[var(--dashboard-primary)]"
              disabled={active.isFetching}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ['md-approvals'] })}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', active.isFetching && 'animate-spin')} /> Refresh
            </Button>
          </div>
        </div>

        {/* ---- load failures ---- */}
        {loadErrors.map((entry) => (
          <div
            key={entry.id}
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800"
          >
            {SOURCE_FALLBACK_LABEL[entry.id]}: {entry.error.message}
          </div>
        ))}

        {/* ---- tabs ---- */}
        <div className="flex flex-wrap gap-2">
          {SOURCE_IDS.map((id) => {
            const label = queries[id].data?.source.label ?? SOURCE_FALLBACK_LABEL[id]
            // ⚠️ The badge is ALWAYS the awaiting count. It never follows the scope toggle — the whole
            // point of the number is "how many need me", not "how many rows are on screen".
            const awaiting = queries[id].data?.summary.awaitingMd
            const isActive = id === activeId
            return (
              <button
                key={id}
                type="button"
                onClick={() => changeSource(id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]',
                  isActive
                    ? 'bg-[var(--dashboard-primary)] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {label}
                {awaiting !== undefined && awaiting > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-black',
                      isActive ? 'bg-white text-[var(--dashboard-primary)]' : 'bg-[var(--dashboard-primary)] text-white',
                    )}
                  >
                    {awaiting}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ---- kpis ---- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Awaiting You"
            value={summary ? summary.awaitingMd.toLocaleString('en-IN') : '—'}
            subtitle={summary ? `${summary.total.toLocaleString('en-IN')} in this workflow` : 'loading'}
            icon={ClipboardCheck}
            colorScheme="amber"
            chartType="bar"
            chartData={branchSeries}
          />
          <KpiCard
            title="Value Awaiting"
            // ⚠️ null means this source has no number at the MD stage. Never render that as ₹0.
            value={summary ? (summary.awaitingValue === null ? '—' : inr(summary.awaitingValue)) : '—'}
            subtitle={
              summary && summary.awaitingValue === null
                ? 'no amount at this stage'
                : `${awaitingRows.length.toLocaleString('en-IN')} requests`
            }
            icon={IndianRupee}
            colorScheme="teal"
            chartType="area"
            chartData={valueSeries}
          />
          <KpiCard
            title="Oldest Waiting"
            value={awaitingRows.length ? `${oldestDays}d` : '—'}
            subtitle={oldestRow ? `${oldestRow.reference} · ${formatDate(oldestRow.createdAt)}` : 'nothing queued'}
            icon={Clock}
            colorScheme="amber"
            chartType="area"
            chartData={ageSeries}
          />
          <KpiCard
            title="Branches Affected"
            value={summary ? branchesAffected.toLocaleString('en-IN') : '—'}
            subtitle={summary ? `of ${summary.branches.length} in this workflow` : 'loading'}
            icon={Building2}
            colorScheme="teal"
            chartType="bar"
            chartData={branchSeries}
          />
        </div>

        {/* ---- outcome panels ---- */}
        {success && !failures && (
          <div className="anim-alert-enter flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4" /> {success}
            </span>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ⚠️ Persistent, not a toast. A partial batch is the normal failure here and the MD has to be
            able to read exactly which ids did not move and why. */}
        {failures && failures.length > 0 && (
          // The enter animation is deliberate on this one: an abrupt appearance reads as "the page
          // glitched"; a brief arrival says "this is here on purpose — read it".
          <div className="anim-alert-enter rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-black text-rose-800">
                <AlertTriangle className="h-4 w-4" />
                {failures.length} {failures.length === 1 ? 'item' : 'items'} did not go through
                {success ? ` · ${success}` : ''}
              </div>
              <button
                type="button"
                onClick={() => setFailures(null)}
                className="rounded-lg p-1 text-rose-700 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {failures.map((f) => (
                <li key={f.id} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs">
                  <span className="font-black text-rose-800">{f.reference}</span>
                  <span className="ml-2 font-mono text-[10px] text-slate-400">{f.id}</span>
                  <div className="mt-0.5 font-semibold text-slate-700">{f.error}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- scope + filters ---- */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            { id: 'awaiting' as const, label: 'Needs my approval' },
            { id: 'all' as const, label: 'All' },
          ]).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setScope(option.id)
                setSelected([])
              }}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-black transition-all focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]',
                scope === option.id
                  ? 'bg-[var(--dashboard-primary)] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {option.label}
            </button>
          ))}

          {/* Sort is a work-queue decision, so it sits next to the scope toggle and wears the same
              pill styling rather than hiding inside a dropdown. */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
              <ArrowDownUp className="h-3 w-3" /> Sort
            </span>
            {([
              { id: 'oldest' as const, label: 'Oldest first' },
              { id: 'newest' as const, label: 'Newest first' },
            ]).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSortOrder(option.id)}
                aria-pressed={sortOrder === option.id}
                className={cn(
                  'rounded-xl px-3 py-2 text-xs font-black transition-all focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]',
                  sortOrder === option.id
                    ? 'bg-[var(--dashboard-primary)] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={cn(CONTROL, 'ml-auto')}
          >
            <option value="all">All branches</option>
            {(summary?.branches ?? []).map((b) => (
              <option key={b.branch} value={b.branch}>
                {b.branchLabel} ({scope === 'awaiting' ? b.awaitingMd : b.total})
              </option>
            ))}
          </select>

          {/* Hidden entirely when the source carries no dealership — an empty select is a dead control. */}
          {dealershipOptions.length > 0 && (
            <select value={dealership} onChange={(e) => setDealership(e.target.value)} className={CONTROL}>
              <option value="all">All dealerships</option>
              {dealershipOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, request or requester"
              className="h-10 w-64 rounded-xl pl-9 text-xs focus-visible:ring-[var(--dashboard-primary)]"
            />
          </div>

          {/* Selection lives on the rows themselves now; this is the only remaining checkbox-style
              control, and it covers exactly the actionable rows the current filters leave visible. */}
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={!selectableIds.length}
            aria-pressed={allSelectableSelected}
            className={cn(
              CONTROL,
              'inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              allSelectableSelected
                ? 'border-[var(--dashboard-primary)] bg-[rgba(var(--dashboard-primary-rgb),0.06)] text-[var(--dashboard-primary)]'
                : 'hover:bg-slate-50',
            )}
          >
            {allSelectableSelected ? (
              <SquareCheck className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {allSelectableSelected ? 'Clear selection' : `Select all ${selectableIds.length}`}
          </button>

          <Button
            variant="outline"
            className="h-10 gap-1.5 rounded-xl text-xs font-bold focus:ring-[var(--dashboard-primary)]"
            disabled={!visibleRows.length}
            onClick={exportCsv}
          >
            <Download className="h-3.5 w-3.5" /> Export {visibleRows.length}
          </Button>
        </div>

        {/* ---- bulk bar ---- */}
        {selected.length > 0 && (
          // anim-bar-enter: 160ms fade+drop so the bar visibly ARRIVES instead of teleporting the
          // layout — this appears mid-click-run, and content jumping under the cursor on a money
          // screen is a misclick risk. One-shot, compositor-only, collapsed under reduced motion.
          <div className="anim-bar-enter sticky top-2 z-30 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200/80 bg-white p-4 shadow-[0_18px_40px_-12px_rgba(var(--dashboard-primary-rgb),0.35)]">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-[var(--dashboard-primary)] px-3 py-1 text-xs font-black text-white">
                  {selected.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-[11px] font-bold text-slate-500 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busySelection}
                  onClick={() => void runAction('approve', selected, '')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--dashboard-primary)] px-4 py-2 text-xs font-black text-white transition-colors hover:bg-[var(--dashboard-primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busySelection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Approve {selected.length}
                </button>
                <button
                  type="button"
                  disabled={busySelection}
                  onClick={() => openRemarkDialog('reject', selected)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
                {source?.supportsHold && (
                  <button
                    type="button"
                    disabled={busySelection}
                    onClick={() => openRemarkDialog('hold', selected)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-black text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PauseCircle className="h-3.5 w-3.5" /> Hold
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* ---- table ---- */}
        <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr
                  className="text-[9px] font-black uppercase tracking-[0.12em] text-white"
                  style={HEADER_BANNER}
                >
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Requested by</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Waiting since</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {active.isLoading && (
                  <tr>
                    <td colSpan={columnCount} className="px-4 py-12 text-center">
                      <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
                      </span>
                    </td>
                  </tr>
                )}

                {!active.isLoading &&
                  visibleRows.map((row) => {
                    const busy = pendingIds.includes(row.id)
                    const days = daysWaiting(row.createdAt)
                    const isSelected = selected.includes(row.id)
                    // ⚠️ Only actionable rows are interactive. A row that is not the MD's to decide
                    // gets no role, no tab stop and no hover affordance — offering one would promise
                    // a selection the bulk bar could never act on.
                    const selectable = row.awaitingMd
                    return (
                      <tr
                        key={row.id}
                        role={selectable ? 'button' : undefined}
                        tabIndex={selectable ? 0 : undefined}
                        aria-selected={selectable ? isSelected : undefined}
                        aria-label={selectable ? `Select ${row.reference}` : undefined}
                        onClick={selectable ? () => toggleRow(row) : undefined}
                        onKeyDown={selectable ? (event) => onRowKeyDown(event, row) : undefined}
                        // Inline so the accent always wins over the row's own border colour, and so
                        // the 4px gutter is reserved even when unselected — no jump on click.
                        style={{
                          borderLeft: `5px solid ${isSelected ? 'var(--dashboard-primary)' : 'transparent'}`,
                          backgroundColor: isSelected ? 'rgba(var(--dashboard-primary-rgb), 0.12)' : undefined,
                        }}
                        className={cn(
                          'border-b border-slate-100 last:border-b-0 transition-colors',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--dashboard-primary)]',
                          selectable && 'cursor-pointer',
                          selectable && !isSelected && 'hover:bg-slate-50',
                          busy && 'opacity-60',
                        )}
                      >
                        <td className="px-4 py-3 font-black text-slate-800">{row.reference}</td>
                        <td className="px-4 py-3 max-w-[22rem] text-slate-700">{row.title}</td>
                        <td className="px-4 py-3 text-slate-600">{row.requestedBy || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-700">{row.branchLabel}</div>
                          {row.dealership && (
                            <div className="text-[10px] font-semibold text-slate-400">{row.dealership}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">
                          {amountDisplay(row)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-700">{formatDate(row.createdAt)}</div>
                          {days !== null && (
                            <span
                              className={cn(
                                'mt-1 inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]',
                                days >= 7
                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-500',
                              )}
                            >
                              {days}d waiting
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {/* ⚠️ Every control in here stops propagation. Without it a click on
                              Approve would ALSO toggle the row's selection underneath it. */}
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              aria-label={`View details for ${row.reference}`}
                              title="View details"
                              onClick={(event) => {
                                event.stopPropagation()
                                setDetailsId(row.id)
                              }}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-[var(--dashboard-primary)] transition-colors hover:bg-[rgba(var(--dashboard-primary-rgb),0.06)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>

                            {row.awaitingMd ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void runAction('approve', [row.id], '')
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--dashboard-primary)] px-2.5 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-[var(--dashboard-primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openRemarkDialog('reject', [row.id])
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-rose-700 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <X className="h-3 w-3" /> Reject
                                </button>
                                {/* Hidden, not disabled — a source without a hold action has no hold. */}
                                {source?.supportsHold && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openRemarkDialog('hold', [row.id])
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <PauseCircle className="h-3 w-3" /> Hold
                                  </button>
                                )}
                              </>
                            ) : (
                              // Not the MD's turn: show whose desk it is on instead of buttons.
                              <span
                                className={cn(
                                  'inline-block rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]',
                                  row.stageLabel.startsWith('Held')
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-slate-200 bg-slate-50 text-slate-500',
                                )}
                              >
                                {row.stageLabel}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                {!active.isLoading && !visibleRows.length && (
                  <tr>
                    <td colSpan={columnCount} className="px-4 py-12 text-center">
                      <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">
                        <Inbox className="h-4 w-4" />
                        {scope === 'awaiting'
                          ? 'Nothing here is waiting on you.'
                          : 'No requests match these filters.'}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Click a row waiting on you to select it, or the eye icon to see the full request. Every
          decision is applied by the module that owns the request, so its own chain rules, audit trail
          and validation still run. A batch can partially fail — anything that does not go through is
          listed above with the reason.
        </p>

      </div>

      {/* ---- remarks dialog ---- */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="rounded-3xl border-slate-200 bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-[var(--dashboard-primary)]">
              {dialog?.action === 'reject' ? 'Reject' : 'Put on hold'}
              {dialog ? ` ${dialog.ids.length} ${dialog.ids.length === 1 ? 'request' : 'requests'}` : ''}
            </DialogTitle>
            <DialogDescription className="text-xs font-semibold text-slate-500">
              {dialog?.action === 'reject'
                ? 'A reason is required — it is written to the module’s audit trail and shown to the requester.'
                : 'Add a note so the requester knows what this is waiting on. Optional.'}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
            placeholder={dialog?.action === 'reject' ? 'Why is this being rejected?' : 'What is it waiting on?'}
            className="rounded-2xl border-slate-200 text-sm focus-visible:ring-[var(--dashboard-primary)]"
          />

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl text-xs font-bold focus:ring-[var(--dashboard-primary)]"
              onClick={() => setDialog(null)}
            >
              Cancel
            </Button>
            <button
              type="button"
              // Disabled until there is a reason — the API rejects a reasonless rejection anyway.
              disabled={dialogInvalid}
              onClick={confirmRemarkDialog}
              className={cn(
                'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-black text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50',
                dialog?.action === 'reject'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-amber-600 hover:bg-amber-700',
              )}
            >
              {dialog?.action === 'reject' ? (
                <>
                  <X className="h-3.5 w-3.5" /> Confirm rejection
                </>
              ) : (
                <>
                  <PauseCircle className="h-3.5 w-3.5" /> Confirm hold
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- details dialog ---- */}
      <Dialog open={detailsRow !== null} onOpenChange={(open) => !open && setDetailsId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl border-slate-200 bg-white sm:max-w-2xl">
          {detailsRow && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-black text-[var(--dashboard-primary)]">
                  {detailsRow.reference}
                </DialogTitle>
                <DialogDescription className="text-xs font-semibold text-slate-600">
                  {detailsRow.title}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Whose desk it is on, and the amount — the two things that decide the outcome. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-block rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]',
                      detailsRow.awaitingMd
                        ? 'border-[rgba(var(--dashboard-primary-rgb),0.3)] bg-[rgba(var(--dashboard-primary-rgb),0.06)] text-[var(--dashboard-primary)]'
                        : detailsRow.stageLabel.startsWith('Held')
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-slate-50 text-slate-500',
                    )}
                  >
                    {detailsRow.stageLabel}
                  </span>
                  <span className="inline-block rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600">
                    {detailsRow.branchLabel}
                  </span>
                  <span className="ml-auto text-sm font-black tabular-nums text-slate-800">
                    {amountDisplay(detailsRow)}
                  </span>
                </div>

                {detailsRow.details.length > 0 ? (
                  <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                    {detailsRow.details.map((entry, index) => (
                      // Labels are not unique — petty cash can legitimately carry two `Department`
                      // lines when the column and the form disagree — so the index is part of the key.
                      <div
                        key={`${entry.label}-${index}`}
                        className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[11rem_1fr] sm:gap-3"
                      >
                        <dt className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
                          {entry.label}
                        </dt>
                        <dd className="text-xs font-semibold break-words whitespace-pre-wrap text-slate-700">
                          {entry.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                    This request carries no additional details.
                  </p>
                )}

                <div>
                  <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                    <Paperclip className="h-3 w-3" />
                    Attachments {detailsRow.attachments.length > 0 && `(${detailsRow.attachments.length})`}
                  </p>
                  {detailsRow.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {detailsRow.attachments.map((url, index) =>
                        isImageUrl(url) ? (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            title={fileNameOf(url, index)}
                            className="block overflow-hidden rounded-xl border border-slate-200 transition-colors hover:border-[var(--dashboard-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={fileNameOf(url, index)}
                              loading="lazy"
                              className="h-24 w-24 bg-slate-50 object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[var(--dashboard-primary)] transition-colors hover:bg-[rgba(var(--dashboard-primary-rgb),0.06)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{fileNameOf(url, index)}</span>
                          </a>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="text-xs font-semibold text-slate-400">
                      Nothing was attached to this request.
                    </p>
                  )}
                </div>

                <a
                  href={source?.href ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--dashboard-primary)] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open the full record in {source?.label ?? 'the source module'}
                </a>
              </div>

              {/* Same handlers as the row — the dialog is another way in, not a second code path. */}
              {detailsRow.awaitingMd && (
                <DialogFooter className="gap-2">
                  {source?.supportsHold && (
                    <button
                      type="button"
                      disabled={detailsBusy}
                      onClick={() => {
                        // One Radix dialog at a time: hand off to the remarks dialog.
                        setDetailsId(null)
                        openRemarkDialog('hold', [detailsRow.id])
                      }}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-white px-4 text-xs font-black text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PauseCircle className="h-3.5 w-3.5" /> Hold
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={() => {
                      setDetailsId(null)
                      openRemarkDialog('reject', [detailsRow.id])
                    }}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                  <button
                    type="button"
                    disabled={detailsBusy}
                    onClick={() => {
                      setDetailsId(null)
                      void runAction('approve', [detailsRow.id], '')
                    }}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--dashboard-primary)] px-4 text-xs font-black text-white transition-colors hover:bg-[var(--dashboard-primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {detailsBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
