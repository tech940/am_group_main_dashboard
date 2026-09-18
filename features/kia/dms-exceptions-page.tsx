'use client'

/**
 * Bookings → DMS Exceptions. Where the DMS (sales, payments, delivery) has moved past the Kia Booking
 * workflow, or disagrees with it — one row per booking that needs someone's attention, never a copy of
 * the whole bookings table.
 *
 * Reads the stored reconciliation (lib/kia/dms-reconciliation). Flags only: nothing here changes a
 * booking — the owner's rule is that people review a discrepancy before internal records change.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowRightLeft,
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck,
  GitCompare,
  HelpCircle,
  Inbox,
  IndianRupee,
  Loader2,
  RefreshCw,
  Search,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Chip, FieldValue, KpiRow, Section, type KpiDatum, type Tone } from '@/components/kia/premium'
import { cn } from '@/lib/utils'
import {
  DMS_PAID_THRESHOLD,
  OUR_STAGE_LABEL,
  RECON_TYPE_META,
  type OurStage,
  type ReconExceptionType,
  type ReconListResponse,
  type ReconListRow,
} from '@/lib/kia/dms-reconciliation/types'

type TypeFilter = ReconExceptionType | 'review' | 'all'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
function shiftMonth(ym: string, delta: number) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
const rupees = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`)
/** ISO dates, and the DMS's own dd/mm/yyyy text dates (sales invoice_date), both as "2 Sep 2026". */
function dateLabel(value: string | null | undefined) {
  if (!value) return '—'
  const dms = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(value.trim())
  const [y, m, d] = dms ? [Number(dms[3]), Number(dms[2]), Number(dms[1])] : value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d || m > 12) return value
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
}
// 'en-IN' is a language, not a time zone — the zone must be named or a UTC server date leaks in.
const istTime = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const OUR_STAGE_TONE: Record<OurStage, Tone> = {
  closed: 'rose', booking: 'neutral', proforma: 'indigo', on_hold: 'neutral', allotted: 'sky', paid: 'amber', delivered: 'emerald',
}
function dmsStage(row: Pick<ReconListRow, 'dmsStatus' | 'deliveryDate' | 'invoiceNo' | 'dmsBookingNo'>): { label: string; tone: Tone } {
  if (!row.dmsBookingNo) return { label: 'Not in DMS', tone: 'neutral' }
  const s = String(row.dmsStatus || '').toUpperCase()
  if (s.includes('CANCEL')) return { label: row.dmsStatus || 'Cancelled', tone: 'rose' }
  if (s === 'RETAIL' || row.deliveryDate) return { label: 'Delivered', tone: 'emerald' }
  if (s === 'INVOICE' || row.invoiceNo) return { label: 'Invoiced', tone: 'violet' }
  if (s === 'ASSIGNMENT') return { label: 'Allotted', tone: 'sky' }
  return { label: row.dmsStatus || 'Booking', tone: 'neutral' }
}
const TYPE_TONE: Record<ReconExceptionType, Tone> = {
  dms_delivered: 'rose', dms_invoiced: 'violet', dms_paid: 'amber', dms_cancelled: 'neutral', internal_ahead: 'teal', unmatched_dms: 'neutral',
}
const SEVERITY_ACCENT: Record<ReconListRow['severity'], string> = {
  critical: 'var(--dashboard-danger, #e11d48)', high: 'var(--dashboard-warning, #f59e0b)', medium: 'var(--kia-hairline-strong)',
}

export function DmsExceptionsPage() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState<string | null>(null)
  const [type, setType] = useState<TypeFilter>('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const list = useQuery<ReconListResponse>({
    queryKey: ['kia-dms-recon', month, type, q, page],
    queryFn: async () => {
      const params = new URLSearchParams({ type, page: String(page), pageSize: '25' })
      if (month) params.set('month', month)
      if (q) params.set('q', q)
      const res = await fetch(`/api/brands/kia/dms-reconciliation?${params}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not load DMS exceptions.')
      return body
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // While a rebuild runs in the background, look again until it lands.
    refetchInterval: (query) => (query.state.data?.freshness.refreshing ? 5_000 : false),
  })
  const data = list.data
  const viewMonth = month ?? data?.month ?? null
  const isCurrent = data?.isCurrentMonth ?? true

  const recheck = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/brands/kia/dms-reconciliation/run', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'The re-check failed.')
      return body as { ran: boolean; reason?: string; opened?: number; resolved?: number }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kia-dms-recon'] })
      queryClient.invalidateQueries({ queryKey: ['kia-dms-recon-count'] })
      queryClient.removeQueries({ queryKey: ['kia-dms-recon-detail'] })
    },
  })

  const kpis = useMemo<KpiDatum[]>(() => {
    const s = data?.summary
    const by = s?.byType
    return [
      { key: 'all', label: 'Total exceptions', value: s?.total ?? 0, icon: GitCompare, tone: 'accent', hint: isCurrent ? 'This month’s bookings, still open' : 'Bookings made this month' },
      { key: 'dms_delivered', label: 'Delivered in DMS', value: by?.dms_delivered ?? 0, icon: Truck, tone: 'rose', hint: 'Not delivered here' },
      { key: 'dms_paid', label: 'Paid in DMS', value: by?.dms_paid ?? 0, icon: IndianRupee, tone: 'amber', hint: `Over ${rupees(DMS_PAID_THRESHOLD)}, not confirmed here` },
      { key: 'dms_invoiced', label: 'Invoiced in DMS', value: by?.dms_invoiced ?? 0, icon: FileCheck, tone: 'violet', hint: 'Not allotted / paid here' },
      { key: 'dms_cancelled', label: 'Cancelled in DMS', value: by?.dms_cancelled ?? 0, icon: Ban, tone: 'neutral', hint: 'Still active here' },
      { key: 'internal_ahead', label: 'Not retailed in DMS', value: by?.internal_ahead ?? 0, icon: ArrowRightLeft, tone: 'teal', hint: 'Delivered here only' },
      { key: 'review', label: 'Needs review', value: s?.review ?? 0, icon: HelpCircle, tone: 'indigo', hint: 'Match not certain' },
      { key: 'unmatched_dms', label: 'Unmatched DMS', value: by?.unmatched_dms ?? 0, icon: Inbox, tone: 'neutral', hint: 'No booking here' },
    ]
  }, [data?.summary, isCurrent])

  const rows = data?.rows ?? []

  /*
   * Every row's detail, fetched in ONE request the moment a page of the list arrives, and seeded into
   * the cache the drawer reads — so opening a record is instant rather than a spinner (owner,
   * 2026-09-18). Only ids not already cached are asked for.
   */
  const rowIds = rows.map((r) => r.id).join(',')
  useEffect(() => {
    const missing = rowIds.split(',').filter((id) => id && !queryClient.getQueryData(['kia-dms-recon-detail', id]))
    if (!missing.length) return
    fetch(`/api/brands/kia/dms-reconciliation/details?ids=${missing.join(',')}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { details?: Detail[] } | null) => {
        for (const detail of body?.details ?? []) queryClient.setQueryData(['kia-dms-recon-detail', detail.item.id], detail)
      })
      .catch(() => { /* the drawer falls back to fetching its own record */ })
  }, [rowIds, queryClient])
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const fresh = data?.freshness

  return (
    <div className="space-y-4">
      {/* Month + freshness. The month is the one control everything else hangs off. */}
      <section className="kia-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="icon" className="h-9 w-9 rounded-xl"
            aria-label="Previous month"
            disabled={!viewMonth}
            onClick={() => { if (viewMonth) { setMonth(shiftMonth(viewMonth, -1)); setPage(1) } }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[11rem] text-center">
            <p className="text-[15px] font-extrabold tracking-tight text-[var(--kia-text)]">{viewMonth ? monthLabel(viewMonth) : '…'}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--kia-text-faint)]">
              {isCurrent ? 'Bookings made this month · open' : 'Bookings made this month · open and fixed'}
            </p>
          </div>
          <Button
            variant="outline" size="icon" className="h-9 w-9 rounded-xl"
            aria-label="Next month"
            disabled={!viewMonth || isCurrent}
            onClick={() => { if (viewMonth) { setMonth(shiftMonth(viewMonth, 1)); setPage(1) } }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isCurrent && data && (
            <Button variant="ghost" size="sm" className="h-9 rounded-xl text-xs font-bold" onClick={() => { setMonth(null); setPage(1) }}>
              Back to {monthLabel(data.currentMonth)}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[11px] font-medium leading-5 text-[var(--kia-text-soft)]">
            {fresh?.refreshing
              ? <span className="inline-flex items-center gap-1.5 font-semibold"><Loader2 className="h-3 w-3 animate-spin" /> Updating from the latest DMS upload…</span>
              : <>Checked {istTime(fresh?.lastRunAt)}</>}
            <span className="mx-1.5 text-[var(--kia-text-faint)]">·</span>
            DMS uploads: sales {istTime(fresh?.feeds.dmsSales)}, payments {istTime(fresh?.feeds.dmsReceipts)}, bookings {istTime(fresh?.feeds.dmsBookings)}
          </p>
          <Button variant="outline" size="sm" className="h-9 rounded-xl text-xs font-bold" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
            {recheck.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Re-check now
          </Button>
        </div>
        {(recheck.isError || fresh?.lastError) && (
          <p role="alert" className="w-full text-[11px] font-semibold text-[var(--dashboard-risk-text)]">
            {recheck.isError ? (recheck.error as Error).message : `The last automatic check failed: ${fresh?.lastError}`}
          </p>
        )}
      </section>

      <KpiRow items={kpis} activeKey={type} onSelect={(key) => { setType(key === type && key !== 'all' ? 'all' : key as TypeFilter); setPage(1) }} />

      <Section
        title={type === 'all' ? 'Bookings out of step with DMS' : type === 'review' ? 'Possible matches to review' : RECON_TYPE_META[type].label}
        description={type === 'all'
          ? 'Where the booking is here, where DMS says it is, and what needs doing. Nothing on this page changes a booking.'
          : type === 'review'
            ? 'The DMS booking was found only by mobile or chassis, or more than one fits. Check before acting.'
            : RECON_TYPE_META[type].action}
        actions={
          <div className="relative w-full min-w-56 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--kia-text-faint)]" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Customer, booking no., DMS no. or chassis"
              aria-label="Search exceptions"
              className="h-9 rounded-xl pl-8 text-xs"
            />
          </div>
        }
        bodyClassName="px-0 pb-0 pt-3 sm:px-0 sm:pb-0"
      >
        <div className="overflow-x-auto border-t border-[var(--kia-hairline)]">
          <table className="w-full min-w-[1080px] text-[11px]">
            <thead style={{ background: 'var(--dashboard-primary)' }}>
              <tr>
                {['Customer', 'Car', 'Here → DMS', 'DMS payment', 'What is wrong', 'Match', 'Age'].map((h) => (
                  <th key={h} scope="col" className={cn('whitespace-nowrap px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-white', h === 'DMS payment' || h === 'Age' ? 'text-right' : '')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr><td colSpan={7} className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--kia-text-faint)]" /></td></tr>
              ) : list.isError ? (
                <tr><td colSpan={7} className="py-16 text-center text-[12px] font-semibold text-[var(--dashboard-risk-text)]">{(list.error as Error).message}</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <p className="text-[13px] font-bold text-[var(--kia-text)]">
                      {q ? 'Nothing matches that search.' : type === 'all' ? `No exceptions for bookings made in ${viewMonth ? monthLabel(viewMonth) : 'this month'}.` : 'None of this kind.'}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-[var(--kia-text-soft)]">
                      {q ? 'Try a booking number, DMS number or chassis.' : 'Every matched booking agrees with DMS.'}
                    </p>
                  </td>
                </tr>
              ) : rows.map((row) => {
                const dms = dmsStage(row)
                const stage = row.ourStage
                return (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    onClick={() => setOpenId(row.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(row.id) } }}
                    className="cursor-pointer border-b border-[var(--kia-hairline)] outline-none transition-colors hover:bg-[var(--kia-surface-sunken)] focus-visible:bg-[var(--kia-surface-sunken)]"
                    style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_ACCENT[row.severity]}`, opacity: row.state === 'resolved' ? 0.62 : 1 }}
                  >
                    <td className="px-3.5 py-3 align-top">
                      <p className="max-w-[12rem] truncate text-[12px] font-extrabold text-[var(--kia-text)]">{row.customerName || '—'}</p>
                      <p className="mt-0.5 font-mono text-[10px] font-semibold text-[var(--kia-text-soft)]">{row.bookingNumber || 'No booking here'}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-[var(--kia-text-faint)]">{[row.mobile, row.dealerCode].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <p className="whitespace-nowrap text-[11px] font-black uppercase text-[var(--kia-text)]">{row.model || '—'}</p>
                      <p className="max-w-[11rem] truncate text-[10px] font-semibold text-[var(--kia-text-soft)]">{row.variant || ''}</p>
                      {row.vin && <p className="mt-0.5 font-mono text-[10px] font-bold tracking-wide text-[var(--kia-accent-text)]">{row.vin}</p>}
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {stage ? <Chip tone={OUR_STAGE_TONE[stage]}>{OUR_STAGE_LABEL[stage]}</Chip> : <Chip tone="neutral">No booking</Chip>}
                        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--kia-text-faint)]" aria-label="while DMS says" />
                        <Chip tone={dms.tone}>{dms.label}</Chip>
                      </div>
                      {row.dmsBookingNo && <p className="mt-1 font-mono text-[10px] font-semibold text-[var(--kia-text-faint)]">DMS {row.dmsBookingNo}</p>}
                    </td>
                    <td className="px-3.5 py-3 text-right align-top">
                      <p className={cn('whitespace-nowrap font-mono text-[12px] tabular-nums', row.paymentReceived ? 'font-black text-[var(--kia-text)]' : 'font-semibold text-[var(--kia-text-soft)]')}>
                        {row.dmsBookingNo ? rupees(row.dmsReceived) : '—'}
                      </p>
                      {row.paymentReceived && <p className="text-[10px] font-bold text-[var(--dashboard-success-text)]">Received</p>}
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={row.kind === 'review' ? 'indigo' : TYPE_TONE[row.type]} dot>
                          {row.kind === 'review' ? `Review · ${RECON_TYPE_META[row.type].short}` : RECON_TYPE_META[row.type].short}
                        </Chip>
                        {row.state === 'resolved' && <Chip tone="emerald">Fixed {row.resolvedAt ? dateLabel(row.resolvedAt) : ''}</Chip>}
                      </div>
                      <p className="mt-1 max-w-[22rem] text-[11px] font-medium leading-snug text-[var(--kia-text)]">{row.headline}</p>
                    </td>
                    <td className="px-3.5 py-3 align-top">
                      <p className={cn('max-w-[9rem] text-[10px] font-bold leading-snug', (row.matchTier ?? 0) >= 5 ? 'text-[var(--dashboard-warning-text)]' : 'text-[var(--kia-text-soft)]')}>
                        {row.matchLabel || (row.kind === 'unmatched_dms' ? 'No match here' : 'Not found in DMS')}
                      </p>
                      {/* A strong identifier can still be under review: two bookings here claim it, or two DMS bookings fit. */}
                      {row.kind === 'review' && (row.matchTier ?? 9) <= 4 && (
                        <p className="mt-0.5 max-w-[9rem] text-[10px] font-semibold leading-snug text-[var(--dashboard-warning-text)]">More than one fits</p>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-right align-top">
                      <p className="whitespace-nowrap font-mono text-[12px] font-black tabular-nums text-[var(--kia-text)]">{row.ageDays}d</p>
                      <p className="whitespace-nowrap text-[10px] font-semibold text-[var(--kia-text-faint)]">
                        {dateLabel(row.eventDate)}
                      </p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <p className="text-[11px] font-semibold text-[var(--kia-text-soft)]">
            {data ? `${data.total} record${data.total === 1 ? '' : 's'}` : ''}
            {data?.freshness.coverage ? ` · ${data.freshness.coverage.matched} of ${data.freshness.coverage.ourBookings} bookings matched to DMS` : ''}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-[11px] font-bold tabular-nums text-[var(--kia-text-soft)]">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </Section>

      <ExceptionDetail id={openId} row={rows.find((r) => r.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </div>
  )
}

type Detail = {
  item: ReconListRow & { matchNote: string | null; candidates: Array<{ bookingNo: string; status: string | null; tier: number; gapDays: number | null; modelAgrees: boolean }>; paidCrossedOn: string | null; lastReceiptDate: string | null; receiptCount: number | null; invoiceDate: string | null; dmsCustomerId: string | null; dmsDealer: string | null }
  booking: Record<string, string | number | null> | null
  dms: {
    booking: Record<string, string | number | null> | null
    history: Array<{ at: string; dealer: string | null; status: string | null }>
    sales: Array<Record<string, string | number | null>>
    receipts: Array<Record<string, string | number | null>>
  }
}

function ExceptionDetail({ id, row, onClose }: { id: string | null; row: ReconListRow | null; onClose: () => void }) {
  const detail = useQuery<Detail>({
    queryKey: ['kia-dms-recon-detail', id],
    enabled: Boolean(id),
    // A prefetched record is used as is; nothing here changes faster than the list itself.
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/dms-reconciliation/${id}`, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Could not load this record.')
      return body
    },
  })
  const d = detail.data
  // The list row already carries the headline, both stages and the payment, so the drawer opens on
  // those at once even if the full record is still on its way.
  const item: Detail['item'] | undefined = d?.item ?? (row ? {
    ...row, matchNote: null, candidates: [], paidCrossedOn: null, lastReceiptDate: null, receiptCount: null,
    invoiceDate: null, dmsCustomerId: null, dmsDealer: null,
  } : undefined)
  const b = d?.booking
  const dmsB = d?.dms.booking
  const stage = item?.ourStage ?? null
  const dms = item ? dmsStage(item) : null
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))

  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="kia-premium w-[calc(100vw-1.5rem)] max-w-5xl gap-0 p-0 sm:rounded-3xl">
        {!item ? (
          <div className="p-10 text-center">
            <DialogTitle className="sr-only">DMS exception</DialogTitle>
            <DialogDescription className="sr-only">Loading</DialogDescription>
            {detail.isError
              ? <p className="text-[12px] font-semibold text-[var(--dashboard-risk-text)]">{(detail.error as Error).message}</p>
              : <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--kia-text-faint)]" />}
          </div>
        ) : (
          <div>
            <header className="border-b border-[var(--kia-hairline)] px-5 pb-4 pt-5 sm:px-6">
              <div className="flex flex-wrap items-center gap-1.5 pr-8">
                <Chip tone={item.kind === 'review' ? 'indigo' : TYPE_TONE[item.type]} dot>{item.kind === 'review' ? 'Needs review' : RECON_TYPE_META[item.type].label}</Chip>
                {item.severity === 'critical' && <Chip tone="rose">Critical</Chip>}
                {item.state === 'resolved' && <Chip tone="emerald">Fixed {dateLabel(item.resolvedAt)}</Chip>}
              </div>
              <DialogTitle className="mt-2 text-lg font-black leading-snug tracking-tight text-[var(--kia-text)] [text-wrap:balance]">
                {item.customerName || 'Customer'}{item.bookingNumber ? <span className="ml-2 font-mono text-[13px] font-bold text-[var(--kia-text-soft)]">{item.bookingNumber}</span> : null}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] font-medium text-[var(--kia-text)]">{item.headline}</DialogDescription>
              <p className="mt-2 text-[12px] font-medium leading-5 text-[var(--kia-text-soft)]">
                <span className="font-bold text-[var(--kia-text)]">What to do: </span>{RECON_TYPE_META[item.type].action}
              </p>
              {item.bookingId && (
                <Link
                  href={`/brands/kia/bookings?bookingId=${item.bookingId}`}
                  prefetch={false}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold"
                  style={{ background: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                >
                  Open booking <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </header>

            <div className="space-y-4 px-5 py-4 sm:px-6">
              {/* The reconciliation in one line: where each side says the sale is. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <FieldValue label="Stage here" value={stage ? <Chip tone={OUR_STAGE_TONE[stage]}>{OUR_STAGE_LABEL[stage]}</Chip> : 'No booking here'} />
                <FieldValue label="DMS sales stage" value={dms ? <Chip tone={dms.tone}>{dms.label}</Chip> : '—'} />
                <FieldValue
                  label="DMS payment"
                  value={item.dmsBookingNo
                    ? <span>{rupees(item.dmsReceived)} <span className="text-[11px] font-semibold text-[var(--kia-text-soft)]">{item.paymentReceived ? `· received${item.paidCrossedOn ? ` by ${dateLabel(item.paidCrossedOn)}` : ''}` : '· not fully paid'}</span></span>
                    : '—'}
                />
              </div>

              <div className="kia-surface-sunken px-3.5 py-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">How this was matched</p>
                <p className="mt-1 text-[12px] font-bold text-[var(--kia-text)]">{item.matchLabel || (item.kind === 'unmatched_dms' ? 'No booking here has this customer’s mobile, PAN or chassis.' : 'No DMS booking found for this customer.')}</p>
                {item.matchNote && <p className="mt-0.5 text-[11px] font-medium text-[var(--kia-text-soft)]">{item.matchNote}</p>}
                {item.kind === 'review' && item.candidates.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {item.candidates.map((c) => (
                      <li key={c.bookingNo + c.tier} className="text-[11px] font-medium text-[var(--kia-text-soft)]">
                        <span className="font-mono font-bold text-[var(--kia-text)]">{c.bookingNo}</span> · {c.status || '—'} · {c.gapDays === null ? 'no date' : `${Math.abs(c.gapDays)} days ${c.gapDays < 0 ? 'before' : 'after'} this booking`}{c.modelAgrees ? '' : ' · different model'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!d ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-busy="true">
                  {['Booking here', 'DMS sales', 'DMS payment'].map((title) => (
                    <div key={title} className="space-y-2">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">{title}</h3>
                      {detail.isError
                        ? <p className="text-[12px] font-semibold text-[var(--dashboard-risk-text)]">{(detail.error as Error).message}</p>
                        : <div className="kia-skeleton h-40 rounded-2xl" />}
                    </div>
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">Booking here</h3>
                  {b ? (
                    <div className="grid grid-cols-2 gap-2">
                      <FieldValue label="Booking" value={text(b.booking_number)} mono className="col-span-2" />
                      <FieldValue label="Mobile" value={text(b.customer_phone)} />
                      <FieldValue label="Branch" value={text(b.dealer_code)} />
                      <FieldValue label="Car" value={[b.model, b.variant, b.color].filter(Boolean).join(' · ')} className="col-span-2" />
                      <FieldValue label="Booked on" value={dateLabel(text(b.booking_date) ?? text(b.created_at))} />
                      <FieldValue label="Sales executive" value={text(b.consultant_name)} />
                      <FieldValue label="Proforma" value={b.proforma_id ? `${text(b.approval_status) ?? '—'}${b.grand_total_cost ? ` · ${rupees(Number(b.grand_total_cost))}` : ''}` : 'Not generated'} className="col-span-2" />
                      <FieldValue label="Allotted chassis" value={text(b.live_vin) ?? text(b.allocated_vin)} mono className="col-span-2" />
                      <FieldValue label="Payment confirmed" value={b.payment_confirmed_at ? dateLabel(text(b.payment_confirmed_at)) : 'No'} />
                      <FieldValue label="Delivered" value={b.delivered_at ? dateLabel(text(b.delivered_at)) : 'No'} />
                    </div>
                  ) : <p className="text-[12px] font-medium text-[var(--kia-text-soft)]">No booking here matches this DMS record.</p>}
                </div>

                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">DMS sales</h3>
                  {item.dmsBookingNo ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <FieldValue label="DMS booking" value={item.dmsBookingNo} mono />
                        <FieldValue label="DMS customer" value={item.dmsCustomerId} mono />
                        <FieldValue label="Name in DMS" value={text(dmsB?.name_of_the_customer)} className="col-span-2" />
                        <FieldValue label="Mobile" value={text(dmsB?.contact_number)} />
                        <FieldValue label="Booked in DMS" value={dateLabel(text(dmsB?.booking_date))} />
                        <FieldValue label="Consultant" value={text(dmsB?.consultant_name)} />
                        <FieldValue label="Finance" value={text(dmsB?.dsa_financier) ?? text(dmsB?.mode_of_purchase)} />
                      </div>
                      {d.dms.sales.map((s) => (
                        <div key={String(s.vin)} className="grid grid-cols-2 gap-2">
                          <FieldValue label="Chassis" value={text(s.vin)} mono className="col-span-2" />
                          <FieldValue label="Invoice" value={text(s.invoice_no)} mono />
                          <FieldValue label="Invoiced" value={dateLabel(text(s.invoice_date))} />
                          <FieldValue label="Delivered in DMS" value={dateLabel(text(s.delivery_date))} />
                          <FieldValue label="Registered to" value={text(s.registration_name)} />
                        </div>
                      ))}
                      {d.dms.history.length > 0 && (
                        <ol className="kia-surface-sunken space-y-1 px-3.5 py-2.5" aria-label="DMS status history">
                          {d.dms.history.map((h, i) => (
                            <li key={h.at + i} className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="font-bold text-[var(--kia-text)]">{h.status || '—'} <span className="font-semibold text-[var(--kia-text-faint)]">{h.dealer}</span></span>
                              <span className="whitespace-nowrap font-medium tabular-nums text-[var(--kia-text-soft)]">{istTime(h.at)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  ) : <p className="text-[12px] font-medium text-[var(--kia-text-soft)]">No DMS booking found for this customer.</p>}
                </div>

                <div className="space-y-2">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">DMS payment</h3>
                  {d.dms.receipts.length ? (
                    <div className="kia-surface-sunken overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--kia-text-faint)]">
                            <th scope="col" className="px-3 py-2">Date</th>
                            <th scope="col" className="px-3 py-2">Mode</th>
                            <th scope="col" className="px-3 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.dms.receipts.map((r) => {
                            const amount = Number(r.receipt_amount ?? 0)
                            return (
                              <tr key={String(r.receipt_no) + String(r.dealer_code)} className="border-t border-[var(--kia-hairline)]">
                                <td className="px-3 py-1.5 font-medium tabular-nums text-[var(--kia-text-soft)]">{dateLabel(text(r.receipt_date))}</td>
                                <td className="px-3 py-1.5">
                                  <p className="font-semibold text-[var(--kia-text)]">{text(r.type_of_payment) ?? '—'}</p>
                                  {r.remarks && <p className="max-w-[9rem] truncate text-[10px] text-[var(--kia-text-faint)]" title={String(r.remarks)}>{String(r.remarks)}</p>}
                                </td>
                                <td className={cn('px-3 py-1.5 text-right font-mono font-bold tabular-nums', amount < 0 ? 'text-[var(--dashboard-risk-text)]' : 'text-[var(--kia-text)]')}>
                                  {amount < 0 ? `−${rupees(-amount)}` : rupees(amount)}
                                </td>
                              </tr>
                            )
                          })}
                          <tr className="border-t border-[var(--kia-hairline-strong)]">
                            <td colSpan={2} className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--kia-text-soft)]">Total received</td>
                            <td className="px-3 py-2 text-right font-mono text-[12px] font-black tabular-nums text-[var(--kia-text)]">{rupees(item.dmsReceived)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-[12px] font-medium text-[var(--kia-text-soft)]">{item.dmsBookingNo ? 'No receipts in DMS for this booking.' : '—'}</p>}
                  <p className="text-[10px] font-medium leading-4 text-[var(--kia-text-faint)]">Counted as paid above {rupees(DMS_PAID_THRESHOLD)} in total, the same line the booking workflow uses. Negative receipts are reversals.</p>
                </div>
              </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
