'use client'

import { useDeferredValue, useMemo, useState, startTransition } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CarFront, History, Loader2, RefreshCw, Search, ShieldCheck, Truck, XCircle } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { logApiTimings } from '@/lib/api/client-timing'
import { cn } from '@/lib/utils'

type SearchParamsInput = Record<string, string | string[] | undefined>

type StockManagementRow = {
  vinNumber: string
  dealerCode: string
  model: string
  variant: string
  color: string
  engineNo: string
  stockStatus: string
  localStatus: 'dms' | 'bbnd' | 'retail'
  stockLocation: string
  kinInvoiceNo: string
  kinInvoiceDate: string
  orderNo: string
  bookingNo: string
  customerName: string
  basicPrice: number
  stockAge: number
  sourceUploadedAt: string | null
  markedAt: string | null
  markedByName: string | null
  notes: string | null
  fromSavedSnapshot: boolean
}

type StockManagementPayload = {
  kpis: { dmsStock: number; bbnd: number; retail: number; disappearedBbnd: number }
  dealerSplit: Array<{ dealer: string; total: number; bbnd: number }>
  rows: StockManagementRow[]
  filters: { dealerOptions: string[]; statusOptions: string[]; modelOptions: string[] }
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number }
}

type HistoryPayload = {
  rows: StockManagementRow[]
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number }
}

const SURFACE = 'rounded-[2rem] border border-[#d5dfea] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'
const FIELD = 'h-11 rounded-2xl border-[#cfd9e6] bg-white text-sm font-semibold text-slate-900'

function firstParam(params: SearchParamsInput, key: string) {
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

function buildQueryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === 'all') continue
    searchParams.set(key, String(value))
  }
  return searchParams.toString()
}

async function fetchJson<T>(url: string, label: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init })
  logApiTimings(response, label)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed for ${label}`)
  }
  return await response.json() as T
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return 'Rs 0'
  if (Math.abs(value) >= 100000) return `Rs ${(value / 100000).toFixed(1)}L`
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'NA'
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

function statusBadge(row: StockManagementRow) {
  if (row.localStatus === 'bbnd') return <Badge className="rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100">BBND</Badge>
  if (row.localStatus === 'retail') return <Badge className="rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Retail</Badge>
  return <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">DMS</Badge>
}

function TableSkeleton({ cells = 9 }: { cells?: number }) {
  return (
    <TableBody>
      {Array.from({ length: 10 }).map((_, index) => (
        <TableRow key={index}>
          {Array.from({ length: cells }).map((__, cellIndex) => (
            <TableCell key={cellIndex}>
              <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableBody>
      <TableRow>
        <TableCell colSpan={colSpan} className="h-32 text-center text-sm font-semibold text-slate-500">
          {label}
        </TableCell>
      </TableRow>
    </TableBody>
  )
}

export function KiaStockManagementPage({ initialSearchParams }: { initialSearchParams: SearchParamsInput }) {
  const queryClient = useQueryClient()
  const [dealerCode, setDealerCode] = useState(firstParam(initialSearchParams, 'dealer_code') || 'all')
  const [status, setStatus] = useState(firstParam(initialSearchParams, 'status') || 'all')
  const [model, setModel] = useState(firstParam(initialSearchParams, 'model') || 'all')
  const [search, setSearch] = useState(firstParam(initialSearchParams, 'search') || '')
  const [page, setPage] = useState(Number(firstParam(initialSearchParams, 'page')) || 1)
  const [historyStatus, setHistoryStatus] = useState<'bbnd' | 'retail'>('retail')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedAction, setSelectedAction] = useState<{ row: StockManagementRow; status: 'bbnd' | 'retail' } | null>(null)
  const [notes, setNotes] = useState('')
  const deferredSearch = useDeferredValue(search)

  const listQueryKey = ['kia-stock-management', dealerCode, status, model, deferredSearch, page]
  const listQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: () => fetchJson<StockManagementPayload>(`/api/brands/kia/stock-management?${buildQueryString({
      dealer_code: dealerCode,
      status,
      model,
      search: deferredSearch,
      page,
      pageSize: 10,
    })}`, 'kia-stock-management'),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  })

  const historyQuery = useQuery({
    queryKey: ['kia-stock-management-history', dealerCode, historyStatus, historyPage],
    queryFn: () => fetchJson<HistoryPayload>(`/api/brands/kia/stock-management/history?${buildQueryString({
      dealer_code: dealerCode,
      status: historyStatus,
      page: historyPage,
      pageSize: 10,
    })}`, 'kia-stock-management-history'),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  })

  const markMutation = useMutation({
    mutationFn: async (input: { row: StockManagementRow; status: 'bbnd' | 'retail'; notes: string }) => {
      return await fetchJson(`/api/brands/kia/stock-management/${encodeURIComponent(input.row.vinNumber)}/status`, 'kia-stock-management-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localStatus: input.status, notes: input.notes }),
      } as RequestInit)
    },
    onSuccess: async () => {
      setSelectedAction(null)
      setNotes('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kia-stock-management'] }),
        queryClient.invalidateQueries({ queryKey: ['kia-stock-management-history'] }),
        queryClient.invalidateQueries({ queryKey: ['kia-stock-report'] }),
      ])
    },
  })

  const data = listQuery.data
  const history = historyQuery.data
  const isRefreshing = listQuery.isFetching || historyQuery.isFetching || markMutation.isPending
  const kpis = useMemo(() => [
    { label: 'DMS Stock', value: data?.kpis.dmsStock ?? 0, helper: 'Latest imported VINs', icon: CarFront },
    { label: 'BBND Active', value: data?.kpis.bbnd ?? 0, helper: 'Visible until Retail', icon: Truck },
    { label: 'Retail Marked', value: data?.kpis.retail ?? 0, helper: 'Hidden from active stock', icon: ShieldCheck },
    { label: 'Disappeared BBND', value: data?.kpis.disappearedBbnd ?? 0, helper: 'Saved snapshot only', icon: XCircle },
  ], [data])

  function resetToFirstPage(fn: () => void) {
    startTransition(() => {
      fn()
      setPage(1)
    })
  }

  return (
    <MainLayout title="Stock Management" subtitle="AM KIA SALES CONTROL">
      <div className="min-h-screen bg-[linear-gradient(180deg,#edf3f9_0%,#e8eef6_100%)] p-5 text-slate-900">
        <section className={cn(SURFACE, 'mb-6 overflow-hidden p-7')}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex rounded-full bg-emerald-50 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
                BBND and Retail Control
              </div>
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Stock Management</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                Track vehicles that disappear from DMS after sold marking, keep BBND visible, and exclude Retail-marked VINs from active stock analytics.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[180px_180px_220px_auto]">
              <Select value={dealerCode} onValueChange={(value) => resetToFirstPage(() => setDealerCode(value))}>
                <SelectTrigger className={FIELD}><SelectValue placeholder="Dealer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dealers</SelectItem>
                  {(data?.filters.dealerOptions || []).map((dealer) => <SelectItem key={dealer} value={dealer}>{dealer}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => resetToFirstPage(() => setStatus(value))}>
                <SelectTrigger className={FIELD}><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="dms">DMS only</SelectItem>
                  <SelectItem value="bbnd">BBND</SelectItem>
                </SelectContent>
              </Select>
              <Select value={model} onValueChange={(value) => resetToFirstPage(() => setModel(value))}>
                <SelectTrigger className={FIELD}><SelectValue placeholder="Model" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All models</SelectItem>
                  {(data?.filters.modelOptions || []).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                className="h-11 rounded-2xl bg-[#071a2b] px-5 text-sm font-black text-white hover:bg-[#102b46]"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['kia-stock-management'] })
                  queryClient.invalidateQueries({ queryKey: ['kia-stock-management-history'] })
                }}
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-4 md:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon
            return (
              <Card key={kpi.label} className={cn(SURFACE, 'rounded-3xl')}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{kpi.label}</p>
                    <p className="mt-3 text-3xl font-black text-slate-950">{kpi.value.toLocaleString('en-IN')}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{kpi.helper}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-950 p-3 text-white"><Icon className="h-5 w-5" /></div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <section className={cn(SURFACE, 'mb-6 p-5')}>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Active Stock Control</h2>
              <p className="text-sm font-semibold text-slate-500">DMS stock plus saved BBND vehicles. Retail-marked VINs are hidden.</p>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => resetToFirstPage(() => setSearch(event.target.value))}
                placeholder="Search VIN, model, customer..."
                className={cn(FIELD, 'pl-9')}
              />
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200">
            <Table>
              <TableHeader className="bg-[#071a2b]">
                <TableRow>
                  {['VIN', 'Dealer', 'Vehicle', 'DMS Status', 'Local', 'Age', 'Value', 'Customer', 'Actions'].map((head) => (
                    <TableHead key={head} className="h-12 text-xs font-black uppercase tracking-[0.16em] text-white">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              {listQuery.isLoading ? <TableSkeleton /> : data?.rows.length ? (
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.vinNumber} className="odd:bg-slate-50/80">
                      <TableCell className="max-w-[180px] truncate text-xs font-black text-slate-950">{row.vinNumber}</TableCell>
                      <TableCell className="text-sm font-bold text-rose-700">{row.dealerCode}</TableCell>
                      <TableCell>
                        <p className="text-sm font-black text-slate-950">{row.model}</p>
                        <p className="max-w-[280px] truncate text-xs font-semibold text-slate-500">{row.variant} · {row.color}</p>
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-slate-600">{row.stockStatus || '-'}</TableCell>
                      <TableCell>{statusBadge(row)}{row.fromSavedSnapshot ? <Badge variant="outline" className="ml-2 rounded-full">Snapshot</Badge> : null}</TableCell>
                      <TableCell className="text-sm font-black">{row.stockAge}d</TableCell>
                      <TableCell className="text-sm font-bold">{formatMoney(row.basicPrice)}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs font-semibold text-slate-600">{row.customerName || row.bookingNo || '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {row.localStatus !== 'bbnd' ? (
                            <Button size="sm" variant="outline" className="rounded-full bg-white text-xs font-black" onClick={() => setSelectedAction({ row, status: 'bbnd' })}>
                              Mark BBND
                            </Button>
                          ) : null}
                          <Button size="sm" className="rounded-full bg-[#071a2b] text-xs font-black text-white hover:bg-[#102b46]" onClick={() => setSelectedAction({ row, status: 'retail' })}>
                            Mark Retail
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              ) : <EmptyRow colSpan={9} label="No active stock found for the selected filters." />}
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm font-semibold text-slate-600">
            <span>Page {data?.pagination.page || page} of {data?.pagination.totalPages || 1} · {data?.pagination.totalRows || 0} rows</span>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-full bg-white" disabled={page <= 1 || listQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <Button variant="outline" className="rounded-full bg-white" disabled={page >= (data?.pagination.totalPages || 1) || listQuery.isFetching} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <Card className={cn(SURFACE, 'rounded-[2rem]')}>
            <CardHeader>
              <CardTitle className="text-xl font-black">Dealer Split</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.dealerSplit || []).map((dealer) => (
                <div key={dealer.dealer} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm font-black">
                    <span>{dealer.dealer}</span>
                    <span>{dealer.total} active · {dealer.bbnd} BBND</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-[#c5162f]" style={{ width: `${Math.min(100, dealer.total ? (dealer.bbnd / dealer.total) * 100 : 0)}%` }} />
                  </div>
                </div>
              ))}
              {!data?.dealerSplit.length ? <p className="text-sm font-semibold text-slate-500">No dealer rows yet.</p> : null}
            </CardContent>
          </Card>

          <Card className={cn(SURFACE, 'rounded-[2rem]')}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl font-black"><History className="h-5 w-5" /> Audit History</CardTitle>
                <p className="mt-1 text-sm font-semibold text-slate-500">Local BBND/Retail actions remain available for audit.</p>
              </div>
              <Select value={historyStatus} onValueChange={(value) => { setHistoryStatus(value === 'bbnd' ? 'bbnd' : 'retail'); setHistoryPage(1) }}>
                <SelectTrigger className="h-10 w-36 rounded-2xl bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="bbnd">BBND</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-3xl border border-slate-200">
                <Table>
                  <TableHeader className="bg-slate-100">
                    <TableRow>
                      {['VIN', 'Dealer', 'Vehicle', 'Marked by', 'Marked at', 'Notes'].map((head) => (
                        <TableHead key={head} className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">{head}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  {historyQuery.isLoading ? <TableSkeleton cells={6} /> : history?.rows.length ? (
                    <TableBody>
                      {history.rows.map((row) => (
                        <TableRow key={`${row.vinNumber}-${row.markedAt}`}>
                          <TableCell className="max-w-[160px] truncate text-xs font-black">{row.vinNumber}</TableCell>
                          <TableCell className="text-sm font-bold">{row.dealerCode}</TableCell>
                          <TableCell className="text-sm font-semibold">{row.model} · {row.variant}</TableCell>
                          <TableCell className="text-sm">{row.markedByName || '-'}</TableCell>
                          <TableCell className="text-sm">{formatDateTime(row.markedAt)}</TableCell>
                          <TableCell className="max-w-[220px] truncate text-sm text-slate-500">{row.notes || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  ) : <EmptyRow colSpan={6} label={`No ${historyStatus.toUpperCase()} history yet.`} />}
                </Table>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" className="rounded-full bg-white" disabled={historyPage <= 1 || historyQuery.isFetching} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>Previous</Button>
                <Button variant="outline" className="rounded-full bg-white" disabled={historyPage >= (history?.pagination.totalPages || 1) || historyQuery.isFetching} onClick={() => setHistoryPage((current) => current + 1)}>Next</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <Dialog open={Boolean(selectedAction)} onOpenChange={(open) => { if (!open && !markMutation.isPending) setSelectedAction(null) }}>
          <DialogContent className="rounded-3xl">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black">
                Mark {selectedAction?.status === 'retail' ? 'Retail' : 'BBND'}
              </DialogTitle>
              <DialogDescription>
                {selectedAction?.status === 'retail'
                  ? 'Retail will hide this VIN from active Stock Management and Stock Report analytics.'
                  : 'BBND keeps this VIN visible even if it disappears from the DMS import.'}
              </DialogDescription>
            </DialogHeader>
            {selectedAction ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                <p className="font-black text-slate-950">{selectedAction.row.model} · {selectedAction.row.variant}</p>
                <p className="mt-1">{selectedAction.row.vinNumber}</p>
                <p className="mt-1">{selectedAction.row.dealerCode} · {selectedAction.row.stockStatus}</p>
              </div>
            ) : null}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional note"
              className="min-h-24 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-900/20"
            />
            {markMutation.error ? <p className="text-sm font-semibold text-red-600">{markMutation.error.message}</p> : null}
            <DialogFooter>
              <Button variant="outline" className="rounded-full bg-white" disabled={markMutation.isPending} onClick={() => setSelectedAction(null)}>Cancel</Button>
              <Button
                className={cn('rounded-full font-black text-white', selectedAction?.status === 'retail' ? 'bg-[#c5162f] hover:bg-[#9f1025]' : 'bg-[#071a2b] hover:bg-[#102b46]')}
                disabled={!selectedAction || markMutation.isPending}
                onClick={() => selectedAction && markMutation.mutate({ row: selectedAction.row, status: selectedAction.status, notes })}
              >
                {markMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  )
}
