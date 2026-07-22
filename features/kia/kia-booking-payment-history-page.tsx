'use client'

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Loader2, IndianRupee, Receipt, Users, BookOpen, Wallet,
  Search, ChevronLeft, ChevronRight, Download, X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Slice = { name: string; count: number; amount: number }
type TrendPoint = { date: string; count: number; amount: number }
type ReceiptRow = {
  id: string; receiptNo: string; receiptDate: string | null; amount: number; paymentType: string
  customer: string; customerId: string; model: string; bookingNo: string; invoiceNo: string
  kec: string; bank: string; chequeNo: string; remarks: string; dealerCode: string
}
type Payload = {
  summary: {
    receiptCount: number; totalAmount: number; avgReceipt: number
    uniqueBookings: number; uniqueCustomers: number; minDate: string | null; maxDate: string | null
  }
  trend: TrendPoint[]
  byPaymentType: Slice[]
  byModel: Slice[]
  byKec: Slice[]
  byBank: Slice[]
  byDealer: Slice[]
  rows: ReceiptRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  filters: { dealers: string[]; paymentTypes: string[] }
}

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
function dealerLabel(code: string) { return DEALER_LABELS[code] ? `${DEALER_LABELS[code]} (${code})` : code }

const PRESETS = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'fy', label: 'This year', days: 0 },
  { key: 'all', label: 'All time', days: -1 },
]

function isoDaysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function yearStartIso() { return `${new Date().getFullYear()}-01-01` }

function formatCurrency(value: number) {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  if (Math.abs(rounded) >= 10000000) return `₹${(rounded / 10000000).toFixed(2)} Cr`
  if (Math.abs(rounded) >= 100000) return `₹${(rounded / 100000).toFixed(2)} L`
  return `₹${rounded.toLocaleString('en-IN')}`
}
function formatFull(value: number) {
  return `₹${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')}`
}
function formatNumber(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')
}
function shortDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}
function longDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function KiaBookingPaymentHistoryPage() {
  const [preset, setPreset] = useState('90d')
  const [startDate, setStartDate] = useState(isoDaysAgo(90))
  const [endDate, setEndDate] = useState(todayIso())
  const [dealer, setDealer] = useState('all')
  const [paymentType, setPaymentType] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  function applyPreset(key: string) {
    setPreset(key)
    setPage(1)
    if (key === '30d') { setStartDate(isoDaysAgo(30)); setEndDate(todayIso()) }
    else if (key === '90d') { setStartDate(isoDaysAgo(90)); setEndDate(todayIso()) }
    else if (key === 'fy') { setStartDate(yearStartIso()); setEndDate(todayIso()) }
    else if (key === 'all') { setStartDate(''); setEndDate('') }
  }

  const query = useQuery<Payload>({
    queryKey: ['kia-booking-payment-history', startDate, endDate, dealer, paymentType, search, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (dealer !== 'all') params.set('dealer', dealer)
      if (paymentType !== 'all') params.set('paymentType', paymentType)
      if (search) params.set('search', search)
      const res = await fetch(`/api/brands/kia/booking-payment-history?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })
  const d = query.data

  function runSearch() { setSearch(searchInput.trim()); setPage(1) }
  function resetFilters() {
    applyPreset('90d'); setDealer('all'); setPaymentType('all'); setSearchInput(''); setSearch(''); setPage(1)
  }

  const dealerOptions = useMemo(() => d?.filters.dealers ?? [], [d])
  const paymentOptions = useMemo(() => d?.filters.paymentTypes ?? [], [d])
  const hasActiveFilters = dealer !== 'all' || paymentType !== 'all' || Boolean(search) || preset !== '90d'

  return (
    <MainLayout title="Booking Payment History" subtitle="Customer payment receipts against bookings — collections register & analytics">
      <div className="space-y-6">
        {/* Filter bar */}
        <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {PRESETS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => applyPreset(o.key)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors',
                      preset === o.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); setPage(1) }}
                  className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
                  aria-label="Start date"
                />
                <span className="text-xs font-black text-slate-400">→</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); setPage(1) }}
                  className="h-9 w-[9.5rem] rounded-xl text-xs font-bold"
                  aria-label="End date"
                />
              </div>

              <Select value={dealer} onValueChange={(v) => { setDealer(v); setPage(1) }}>
                <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue placeholder="All dealers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dealers</SelectItem>
                  {dealerOptions.map((code) => <SelectItem key={code} value={code}>{dealerLabel(code)}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={paymentType} onValueChange={(v) => { setPaymentType(v); setPage(1) }}>
                <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue placeholder="All payment types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All payment types</SelectItem>
                  {paymentOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[16rem]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                  placeholder="Search customer, receipt no, booking (B…), invoice, model, consultant…"
                  className="h-9 rounded-xl pl-9 text-xs font-semibold"
                />
              </div>
              <Button onClick={runSearch} className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-black uppercase tracking-wider hover:bg-slate-800">Search</Button>
              {hasActiveFilters && (
                <Button onClick={resetFilters} variant="outline" className="h-9 rounded-xl px-3 text-xs font-bold">
                  <X className="mr-1 h-3.5 w-3.5" /> Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {query.isLoading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(query.error as Error)?.message || 'Failed to load.'}</div>
        ) : d ? (
          <div className={cn('space-y-6 transition-opacity', query.isFetching && 'opacity-60')}>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi icon={<IndianRupee className="h-4 w-4" />} label="Total collected" value={formatCurrency(d.summary.totalAmount)} tone="text-emerald-600" sub={formatFull(d.summary.totalAmount)} />
              <Kpi icon={<Receipt className="h-4 w-4" />} label="Receipts" value={formatNumber(d.summary.receiptCount)} tone="text-indigo-600" />
              <Kpi icon={<Wallet className="h-4 w-4" />} label="Avg receipt" value={formatCurrency(d.summary.avgReceipt)} tone="text-slate-700" />
              <Kpi icon={<BookOpen className="h-4 w-4" />} label="Bookings paid" value={formatNumber(d.summary.uniqueBookings)} tone="text-sky-600" />
              <Kpi icon={<Users className="h-4 w-4" />} label="Customers" value={formatNumber(d.summary.uniqueCustomers)} tone="text-amber-600" />
            </div>

            {d.summary.minDate && (
              <p className="-mt-3 text-[11px] font-bold text-slate-400">
                Showing receipts from {longDate(d.summary.minDate)} to {longDate(d.summary.maxDate)}
              </p>
            )}

            {/* Collections trend */}
            <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
              <CardContent className="p-5">
                <p className="mb-3 text-[12px] font-black uppercase tracking-wider text-slate-500">Daily collections</p>
                <div className="h-64 w-full">
                  {d.trend.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[12px] font-semibold text-slate-400">No receipts in this period.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={d.trend} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={Math.max(0, Math.floor(d.trend.length / 12))} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(v) => formatCurrency(Number(v))} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={64} />
                        <Tooltip
                          labelFormatter={(v) => shortDate(String(v))}
                          formatter={(value, key) => key === 'amount' ? [formatFull(Number(value)), 'Collected'] : [formatNumber(Number(value)), 'Receipts']}
                          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600 }}
                        />
                        <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fill="url(#collGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Breakdowns */}
            <div className="grid gap-3 lg:grid-cols-2">
              <BreakdownCard title="By payment mode" items={d.byPaymentType} total={d.summary.totalAmount} tone="bg-indigo-500" />
              <BreakdownCard title="By model" items={d.byModel} total={d.summary.totalAmount} tone="bg-emerald-500" />
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <BreakdownCard title="By dealer" items={d.byDealer} total={d.summary.totalAmount} tone="bg-sky-500" mapName={dealerLabel} />
              <BreakdownCard title="Top consultants (KEC)" items={d.byKec} total={d.summary.totalAmount} tone="bg-amber-500" />
              <BreakdownCard title="Top banks" items={d.byBank} total={d.summary.totalAmount} tone="bg-violet-500" />
            </div>

            {/* Receipt list */}
            <Card className="overflow-hidden rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--kia-hairline)] px-5 py-3">
                <p className="text-[12px] font-black uppercase tracking-wider text-slate-500">
                  Receipts <span className="ml-1 text-slate-400">· {formatNumber(d.pagination.total)}</span>
                </p>
                <Button
                  variant="outline"
                  className="h-8 rounded-lg px-3 text-[11px] font-bold"
                  onClick={() => exportCsv(d.rows)}
                  disabled={d.rows.length === 0}
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> Export page
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--kia-hairline)] bg-slate-50/60">
                      {['Date', 'Receipt', 'Customer', 'Booking', 'Model', 'Mode', 'Consultant', 'Dealer', 'Amount'].map((h, i) => (
                        <th key={h} className={cn('whitespace-nowrap px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400', i === 8 ? 'text-right' : 'text-left')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.length === 0 ? (
                      <tr><td colSpan={9} className="p-10 text-center text-[12px] font-semibold text-slate-400">No receipts match these filters.</td></tr>
                    ) : d.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600">{longDate(r.receiptDate)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-bold text-[var(--kia-text)]">{r.receiptNo || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-bold text-[var(--kia-text)]">{r.customer || '—'}</div>
                          {r.invoiceNo && <div className="text-[11px] font-semibold text-slate-400">Inv {r.invoiceNo}</div>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600">{r.bookingNo || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600">{r.model || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <ModeBadge mode={r.paymentType} />
                          {r.bank && <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{r.bank}</div>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600">{r.kec || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-500">{DEALER_LABELS[r.dealerCode] || r.dealerCode || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-black text-emerald-700">{formatFull(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-[var(--kia-hairline)] px-5 py-3">
                <p className="text-[11px] font-bold text-slate-400">
                  Page {d.pagination.page} of {d.pagination.totalPages}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" className="h-8 w-8 rounded-lg p-0" disabled={d.pagination.page <= 1 || query.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="h-8 w-8 rounded-lg p-0" disabled={d.pagination.page >= d.pagination.totalPages || query.isFetching} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </MainLayout>
  )
}

function Kpi({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string | number; tone: string; sub?: string }) {
  return (
    <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
      <CardContent className="p-4">
        <div className={cn('flex items-center gap-1.5', tone)}>{icon}<span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span></div>
        <p className={cn('mt-1 text-2xl font-black', tone)}>{value}</p>
        {sub && <p className="text-[10px] font-bold text-slate-400">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function BreakdownCard({ title, items, total, tone, mapName }: { title: string; items: Slice[]; total: number; tone: string; mapName?: (name: string) => string }) {
  const max = Math.max(1, ...items.map((i) => i.amount))
  return (
    <Card className="rounded-2xl border border-[var(--kia-hairline)] bg-[var(--kia-surface)] shadow-sm">
      <CardContent className="p-5">
        <p className="mb-3 text-[12px] font-black uppercase tracking-wider text-slate-500">{title}</p>
        {items.length === 0 ? (
          <p className="py-6 text-center text-[12px] font-semibold text-slate-400">No data in this period.</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((i) => (
              <div key={i.name}>
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span className="truncate pr-2 text-slate-600">{mapName ? mapName(i.name) : i.name}</span>
                  <span className="shrink-0 text-slate-500">
                    {formatCurrency(i.amount)}
                    {total > 0 && <span className="ml-1 text-slate-400">· {Math.round((i.amount / total) * 100)}%</span>}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.round((i.amount / max) * 100)}%` }} />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[10px] font-bold text-slate-400">{formatNumber(i.count)} rcpt</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ModeBadge({ mode }: { mode: string }) {
  const m = mode.toLowerCase()
  const tone =
    m.includes('online') || m.includes('neft') || m.includes('rtgs') || m.includes('upi') ? 'bg-indigo-50 text-indigo-700'
    : m.includes('cash') ? 'bg-emerald-50 text-emerald-700'
    : m.includes('cheque') || m.includes('check') ? 'bg-amber-50 text-amber-700'
    : m.includes('card') ? 'bg-sky-50 text-sky-700'
    : 'bg-slate-100 text-slate-600'
  return <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide', tone)}>{mode || '—'}</span>
}

function exportCsv(rows: ReceiptRow[]) {
  if (typeof document === 'undefined' || rows.length === 0) return
  const headers = ['Date', 'Receipt No', 'Customer', 'Customer ID', 'Booking', 'Invoice', 'Model', 'Payment Mode', 'Bank', 'Cheque No', 'Consultant', 'Dealer', 'Amount', 'Remarks']
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push([
      r.receiptDate || '', r.receiptNo, r.customer, r.customerId, r.bookingNo, r.invoiceNo,
      r.model, r.paymentType, r.bank, r.chequeNo, r.kec, r.dealerCode, r.amount, r.remarks,
    ].map(escape).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kia-booking-payments-${todayIso()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
