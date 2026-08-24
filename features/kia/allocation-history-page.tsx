'use client'

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { History, Loader2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * VEHICLE ALLOCATION HISTORY — permanent audit trail.
 *
 * Read-only by design. Every row answers: which booking, which vehicle, who allocated it, when the
 * countdown expired, when it went back to free stock, and why.
 */

type Row = {
  id: string; bookingId: string; bookingNumber: string; customerName: string; dealerCode: string
  vin: string; model: string; variant: string; color: string; engineNo: string; stockSource: string
  /** From the booking's proforma. NULL when the booking has no proforma yet — not the same as 0. */
  bookingAmount: number | null
  allocatedBy: string; allocatedAt: string | null; expiresAt: string | null
  releasedBy: string | null; releasedAt: string | null; releaseReason: string | null
  paymentConfirmedAt: string | null; allocationStatus: string
  outcome: string; heldMinutes: number | null; expired: boolean; overdue: boolean
}

// Mirrors the exclusive buckets in lib/kia/allocation-history.ts — every event is in exactly one.
// 'overdue' is a subset of 'active', offered separately because it is the queue that needs chasing.
const OUTCOMES = [
  { key: 'all', label: 'All events' },
  { key: 'active', label: 'Awaiting payment' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Payment confirmed' },
  { key: 'no_payment', label: 'Released — no payment' },
  { key: 'manual', label: 'Released — manual' },
] as const

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const nfmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN')
/**
 * Booking amount for one row. NULL renders as an em dash, never "₹0" — 32 of 144 allocations belong
 * to bookings with no proforma, and printing ₹0 there would assert a deposit nobody recorded.
 */
const money = (n: number | null) => (n === null || n === undefined ? '—' : `₹${nfmt(n)}`)

function held(minutes: number | null) {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  return h < 48 ? `${h}h ${minutes % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

function OutcomePill({ outcome, expired, overdue }: { outcome: string; expired: boolean; overdue: boolean }) {
  let cls = 'bg-slate-50 text-slate-700 border-slate-200'
  let dotCls = 'bg-slate-500'

  if (outcome === 'Payment confirmed') {
    cls = 'bg-emerald-50 text-emerald-800 border-emerald-300'
    dotCls = 'bg-emerald-500'
  } else if (outcome === 'Awaiting payment') {
    if (overdue) {
      cls = 'bg-amber-50 text-amber-800 border-amber-300'
      dotCls = 'bg-amber-500'
    } else {
      cls = 'bg-blue-50 text-blue-800 border-blue-300'
      dotCls = 'bg-blue-500'
    }
  } else if (outcome.includes('no payment')) {
    cls = 'bg-rose-50 text-rose-800 border-rose-300'
    dotCls = 'bg-rose-500'
  } else if (outcome.includes('manual') || outcome.includes('Released')) {
    cls = 'bg-orange-50 text-orange-800 border-orange-300'
    dotCls = 'bg-orange-500'
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[9.5px] font-bold shadow-xs', cls)}
      title={expired ? 'Released at or after the countdown expiry' : undefined}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotCls)} />
      <span>{outcome}</span>
      {overdue && <span className="font-black text-amber-700">· Overdue</span>}
    </span>
  )
}

/**
 * `embedded` = rendered as the "Allocation History" tab inside the Bookings (Kia Proforma) shell.
 * That shell already provides MainLayout and a ModuleHeader with the title, so repeating either
 * would nest a layout inside a layout and show the heading twice. The standalone route keeps both.
 */
export function AllocationHistoryPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [search, setSearch] = useState('')
  const [outcome, setOutcome] = useState<string>('all')
  const [page, setPage] = useState(1)

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' })
    if (search.trim()) p.set('search', search.trim())
    if (outcome !== 'all') p.set('outcome', outcome)
    return p.toString()
  }, [page, search, outcome])

  const q = useQuery({
    queryKey: ['kia-allocation-history', params],
    queryFn: async () => {
      const res = await fetch(`/api/brands/kia/allocation-history?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load allocation history')
      return res.json()
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const rows: Row[] = q.data?.rows || []
  const s = q.data?.summary

  const exportCsv = () => {
    if (typeof document === 'undefined' || !rows.length) return
    const head = ['Booking ID', 'Customer', 'Dealer', 'Model', 'Variant', 'Colour', 'VIN', 'Engine No',
      'Booking Amount', 'Allocated By', 'Allocated At', 'Countdown Expiry', 'Released At', 'Released By', 'Reason', 'Held', 'Status']
    const esc = (v: string | number) => {
      const t = String(v ?? '')
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const lines = [head.join(','), ...rows.map((r) => [
      r.bookingNumber, r.customerName, r.dealerCode, r.model, r.variant, r.color, r.vin, r.engineNo,
      // Raw number for the CSV (no ₹, no separators) so it lands in Excel as a number, not text.
      r.bookingAmount === null ? '' : r.bookingAmount,
      r.allocatedBy, fmt(r.allocatedAt), fmt(r.expiresAt), fmt(r.releasedAt), r.releasedBy || '',
      r.releaseReason || '', held(r.heldMinutes), r.outcome,
    ].map(esc).join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `kia-allocation-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const body = (
      <div className={cn('space-y-4', embedded ? '' : 'p-4')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {embedded ? (
            // The shell's ModuleHeader already names the tab; keep only the one-line reassurance
            // that the trail is permanent, which is the point users need to see here.
            <p className="text-[12px] font-medium text-slate-500">
              Every allocation and release, permanently. Records are never removed when a vehicle returns to free stock.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <History className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-950">Vehicle Allocation History</h1>
                <p className="text-[12px] font-medium text-slate-500">
                  Every allocation and release, permanently. Records are never removed when a vehicle returns to free stock.
                </p>
              </div>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}
            className="h-9 rounded-xl text-[11px] font-bold">
            <Download className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> Export CSV
          </Button>
        </div>

        {s && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {([
              ['Total events', nfmt(s.total), 'bg-slate-900', `across ${nfmt(s.vehicles)} vehicles`],
              ['Awaiting payment', nfmt(s.active), 'bg-blue-600', s.overdue > 0 ? `${nfmt(s.overdue)} past the countdown` : 'all within the window'],
              ['Payment confirmed', nfmt(s.paid), 'bg-emerald-600', 'held and paid for'],
              ['Released — no payment', nfmt(s.noPayment), 'bg-rose-600', 'returned to free stock'],
              ['Released — manual', nfmt(s.manual), 'bg-amber-600', 'released for another reason'],
              /*
               * Booking amount over the WHOLE filtered trail, not the page — a footer total under a
               * paginated table describes only what is on screen while looking like the total.
               * Counted once per BOOKING: 38 of 74 bookings hold more than one allocation, so
               * summing per row inflated ₹10.37L to ₹18.96L.
               */
              [
                'Booking amount',
                `₹${nfmt(s.bookingAmountTotal)}`,
                'bg-indigo-600',
                `from ${nfmt(s.bookingAmountRows)} booking${s.bookingAmountRows === 1 ? '' : 's'} with a proforma`,
              ],
            ] as [string, string, string, string][]).map(([label, value, tone, note]) => (
              <Card key={label} className="rounded-2xl border border-slate-200 bg-white shadow-xs">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', tone)} />
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
                  </div>
                  <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{value}</p>
                  <p className="text-[10px] font-medium text-slate-400">{note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search booking, customer, VIN, model or who allocated..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="h-9 rounded-xl border-slate-200 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {OUTCOMES.map((o) => (
                <button key={o.key} type="button" onClick={() => { setOutcome(o.key); setPage(1) }}
                  className={cn('rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all',
                    outcome === o.key ? 'bg-[#071a2b] text-white shadow-sm' : 'text-slate-600 hover:bg-white')}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <p className="text-[11px] font-bold text-slate-700">
              {q.isLoading ? 'Loading…' : `${nfmt(q.data?.total || 0)} allocation events`}
              {q.data?.totalPages > 1 ? ` · page ${q.data.page} of ${q.data.totalPages}` : ''}
            </p>
            {q.isFetching && !q.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#074e5b] text-white">
                <tr>
                  {['Booking', 'Customer', 'Vehicle', 'Booking amount', 'Allocated by', 'Allocated at', 'Countdown expiry',
                    'Returned to free stock', 'Reason', 'Held', 'Status'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className={`whitespace-nowrap px-3.5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-100 ${h === 'Booking amount' ? 'text-right' : 'text-left'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.isLoading || q.isPlaceholderData ? (
                  <tr><td colSpan={11} className="py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></td></tr>
                ) : q.isError ? (
                  <tr><td colSpan={11} className="py-16 text-center text-[12px] font-semibold text-rose-700">{(q.error as Error)?.message}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={11} className="py-16 text-center text-[12px] font-semibold text-slate-400">No allocation events match this filter.</td></tr>
                ) : rows.map((r) => {
                  const isPaid = r.outcome === 'Payment confirmed'
                  const isActive = r.outcome === 'Awaiting payment'
                  const isOverdue = r.overdue
                  const isNoPayment = r.outcome.includes('no payment')
                  const isManual = r.outcome.includes('manual')

                  let rowBorderCls = 'border-l-4 border-l-slate-300'
                  let rowBgCls = 'hover:bg-slate-50/80'

                  if (isPaid) {
                    rowBorderCls = 'border-l-4 border-l-emerald-500 bg-emerald-50/15 hover:bg-emerald-50/35'
                  } else if (isActive && isOverdue) {
                    rowBorderCls = 'border-l-4 border-l-amber-500 bg-amber-50/20 hover:bg-amber-50/45'
                  } else if (isActive) {
                    rowBorderCls = 'border-l-4 border-l-blue-500 bg-blue-50/10 hover:bg-blue-50/30'
                  } else if (isNoPayment) {
                    rowBorderCls = 'border-l-4 border-l-rose-500 bg-rose-50/10 hover:bg-rose-50/30'
                  } else if (isManual) {
                    rowBorderCls = 'border-l-4 border-l-orange-400 bg-orange-50/10 hover:bg-orange-50/30'
                  }

                  return (
                    <tr key={r.id} className={cn('transition-colors', rowBorderCls, rowBgCls)}>
                      {/* 1. Booking */}
                      <td className="whitespace-nowrap px-3.5 py-3">
                        <span className="inline-block font-mono text-[10.5px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded shadow-xs">
                          {r.bookingNumber || '—'}
                        </span>
                        {r.dealerCode && (
                          <div className="mt-1">
                            <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200/70">
                              {r.dealerCode}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 2. Customer */}
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-700 text-[10px] font-black shadow-xs">
                            {r.customerName ? r.customerName.charAt(0).toUpperCase() : 'C'}
                          </div>
                          <span className="font-bold text-slate-900 leading-tight">
                            {r.customerName || '—'}
                          </span>
                        </div>
                      </td>

                      {/* 3. Vehicle */}
                      <td className="px-3.5 py-3">
                        <p className="font-bold text-slate-950 text-[11px] tracking-tight">{r.model || '—'}</p>
                        <div className="mt-0.5">
                          <span className="inline-block bg-slate-100 text-slate-700 font-medium text-[9.5px] px-1.5 py-0.5 rounded border border-slate-200/80">
                            {[r.variant, r.color].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                        {r.vin && (
                          <div className="mt-0.5">
                            <span className="inline-block font-mono text-[9px] font-semibold text-amber-900 bg-amber-50/90 border border-amber-200/80 px-1.5 py-0.2 rounded">
                              {r.vin}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 4. Booking Amount */}
                      <td className="whitespace-nowrap px-3.5 py-3 text-right font-bold tabular-nums">
                        {r.bookingAmount !== null && r.bookingAmount !== undefined ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/90 font-bold tabular-nums text-[11.5px] shadow-xs">
                            {money(r.bookingAmount)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">—</span>
                        )}
                      </td>

                      {/* 5. Allocated By */}
                      <td className="px-3.5 py-3">
                        <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 text-sky-800 border border-sky-200/80 px-2 py-0.5 text-[10px] font-semibold">
                          {r.allocatedBy}
                        </span>
                      </td>

                      {/* 6. Allocated At */}
                      <td className="whitespace-nowrap px-3.5 py-3 text-slate-700 font-medium text-[10.5px]">
                        {fmt(r.allocatedAt)}
                      </td>

                      {/* 7. Countdown Expiry */}
                      <td className="whitespace-nowrap px-3.5 py-3">
                        {r.expired || r.overdue ? (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            {fmt(r.expiresAt)}
                          </span>
                        ) : (
                          <span className="text-slate-700 font-medium text-[10.5px]">{fmt(r.expiresAt)}</span>
                        )}
                      </td>

                      {/* 8. Returned to Free Stock */}
                      <td className="whitespace-nowrap px-3.5 py-3">
                        {r.releasedAt ? (
                          <div>
                            <span className="inline-block font-semibold text-rose-700 text-[10px] bg-rose-50/80 px-1.5 py-0.5 rounded border border-rose-200/70">
                              {fmt(r.releasedAt)}
                            </span>
                            {r.releasedBy && <p className="text-[9px] font-medium text-slate-500 mt-0.5">by {r.releasedBy}</p>}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-medium">—</span>
                        )}
                      </td>

                      {/* 9. Reason */}
                      <td className="max-w-52 px-3.5 py-3 text-slate-700 text-[10.5px] font-medium leading-relaxed">
                        {r.releaseReason || '—'}
                      </td>

                      {/* 10. Held */}
                      <td className="whitespace-nowrap px-3.5 py-3">
                        {r.heldMinutes !== null ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200/80 font-bold text-[10px] tabular-nums">
                            {held(r.heldMinutes)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">—</span>
                        )}
                      </td>

                      {/* 11. Status */}
                      <td className="px-3.5 py-3">
                        <OutcomePill outcome={r.outcome} expired={r.expired} overdue={r.overdue} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {q.data?.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <p className="text-[11px] font-semibold text-slate-500">
                Showing {nfmt((q.data.page - 1) * q.data.pageSize + 1)}–{nfmt(Math.min(q.data.page * q.data.pageSize, q.data.total))} of {nfmt(q.data.total)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" disabled={q.data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </Button>
                <Button variant="outline" size="sm" className="h-8 rounded-lg text-[11px]" disabled={q.data.page >= q.data.totalPages}
                  onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="px-1 text-[10px] text-slate-400">
          Rows are written when a vehicle is allocated and updated when it is released — never deleted, so a vehicle
          re-allocated later appears as a separate event. &quot;Released — no payment&quot; is the automatic return to
          free stock when the countdown expires before Accounts confirms payment; &quot;Overdue&quot; is still held with
          the countdown already past. Every event falls in exactly one bucket, so the five counts above add up to the total.
        </p>
      </div>
  )

  return embedded ? body : <MainLayout>{body}</MainLayout>
}
