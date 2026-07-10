'use client'

import { FormEvent, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  Search,
  Wrench,
  XCircle,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'

type RepairOrderRow = {
  id: string
  roNo: string
  roDate: string | null
  regNo: string
  vin: string
  model: string
  workType: string
  serviceAdvisor: string
  technician: string
  status: string
  newRoStatus: string
  delayReason?: string | null
  vehicleType: string
  ucCategory: string
  mileage: string
  dealerCode: string
  promiseDate: string | null
  closingDate: string | null
  cancelDate: string | null
  labourAmount: number | string
  partsAmount: number | string
  otherAmount: number | string
  totalAmount: number | string
  uploadedAt: string | null
}

type RepairOrdersPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    warning?: string
  }
  summary: {
    total: number
    delivered: number
    open: number
    cancelled: number
    labourAmount: number | string
    partsAmount: number | string
    totalAmount: number | string
    avgBilling: number | string
  }
  rows: RepairOrderRow[]
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
  options: {
    statuses: string[]
    workTypes: string[]
    advisors: string[]
  }
}

const PAGE_SIZE = 10
const DASHBOARD_STALE_TIME_MS = 30 * 60 * 1000

function buildQueryString(params: Record<string, string | number>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== 'all') searchParams.set(key, String(value))
  })
  return searchParams.toString()
}

function safeParam(searchParams: URLSearchParams, key: string, fallback = '') {
  return searchParams.get(key) || fallback
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} IST`
}

function numberFormat(value: unknown) {
  const parsed = Number(value || 0)
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(parsed) ? parsed : 0)
}

function formatCurrency(value: unknown) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return 'Rs 0'
  if (Math.abs(parsed) >= 100000) {
    return `Rs ${(parsed / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`
  }
  return `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(parsed)}`
}

function shortStatus(status: string) {
  const normalized = status.trim().toLowerCase()
  if (normalized.includes('deliver') || normalized === 'closed' || normalized === 'close') return 'delivered'
  if (normalized.includes('cancel')) return 'cancelled'
  return 'open'
}

function statusBadgeClass(status: string) {
  const type = shortStatus(status)
  if (type === 'delivered') return 'border-emerald-200 bg-white text-emerald-700'
  if (type === 'cancelled') return 'border-rose-200 bg-white text-rose-700'
  return 'border-amber-200 bg-white text-amber-700'
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof Wrench
  label: string
  value: string
  helper: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-white text-[var(--dashboard-action-bg)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs font-bold text-slate-500">{helper}</p>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={`hyundai-ro-summary-skeleton-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-3 w-28 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-4 h-7 w-20 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-4 h-3 w-32 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: PAGE_SIZE }).map((_, rowIndex) => (
        <tr key={`hyundai-ro-table-skeleton-${rowIndex}`}>
          {Array.from({ length: 13 }).map((__, columnIndex) => (
            <td key={`hyundai-ro-table-skeleton-${rowIndex}-${columnIndex}`} className="border border-slate-200 bg-white px-3 py-4">
              <div className={cn('h-4 animate-pulse rounded-full bg-slate-100', columnIndex % 3 === 0 ? 'w-28' : columnIndex % 3 === 1 ? 'w-20' : 'w-36')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function HyundaiRepairOrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const page = Number(safeParam(searchParams, 'page', '1')) || 1

  const filters = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    search: safeParam(searchParams, 'search'),
    status: safeParam(searchParams, 'status', 'all'),
    workType: safeParam(searchParams, 'workType', 'all'),
    advisor: safeParam(searchParams, 'advisor', 'all'),
    startDate: safeParam(searchParams, 'startDate'),
    endDate: safeParam(searchParams, 'endDate'),
  }), [page, searchParams])

  const queryString = useMemo(() => buildQueryString(filters), [filters])

  const { data, error, isLoading, isFetching, refetch } = useQuery<RepairOrdersPayload>({
    queryKey: ['hyundai-repair-orders', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/hyundai/repair-orders?${queryString}`)
      logApiTimings(response, 'hyundai-repair-orders')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Hyundai Repair Orders')
      return payload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_STALE_TIME_MS,
  })

  const updateFilters = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([key, value]) => {
      const text = String(value)
      if (!text || text === 'all') params.delete(key)
      else params.set(key, text)
    })
    if (!('page' in updates)) params.set('page', '1')
    router.replace(`/brands/hyundai/repair-orders?${params.toString()}`, { scroll: false })
  }

  const clearFilters = () => {
    router.replace('/brands/hyundai/repair-orders', { scroll: false })
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    updateFilters({ search: String(formData.get('search') || '').trim() })
  }

  const summary = data?.summary || {
    total: 0,
    delivered: 0,
    open: 0,
    cancelled: 0,
    labourAmount: 0,
    partsAmount: 0,
    totalAmount: 0,
    avgBilling: 0,
  }
  const pagination = data?.pagination || { page, pageSize: PAGE_SIZE, totalRows: 0, totalPages: 1 }
  const showSkeleton = isLoading || isFetching

  return (
    <MainLayout title="AM Hyundai" subtitle="Repair order register">
      <div className="space-y-4">
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white p-5 shadow-2xl shadow-slate-900/5">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,var(--dashboard-primary-soft),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-white text-[var(--dashboard-action-bg)]">
                <Wrench className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Hyundai Service</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Repair Orders</h1>
                <p className="mt-2 text-xs font-bold text-slate-500">
                  Source last updated: {formatDateTime(data?.meta.sourceUpdatedAt)}
                </p>
              </div>
            </div>
            <Button type="button" onClick={() => void refetch()} className="h-11 rounded-2xl px-5" disabled={isFetching}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </section>

        {data?.meta.warning && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            {data.meta.warning}
          </section>
        )}

        {error && (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-900">
            {error instanceof Error ? error.message : 'Hyundai Repair Orders could not be loaded.'}
          </section>
        )}

        {showSkeleton && !data ? (
          <SummarySkeleton />
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard icon={Wrench} label="Repair Orders" value={numberFormat(summary.total)} helper="Rows matching current filters" />
            <SummaryCard icon={Clock} label="Open / WIP" value={numberFormat(summary.open)} helper="Not delivered or cancelled" />
            <SummaryCard icon={CheckCircle2} label="Delivered" value={numberFormat(summary.delivered)} helper="Closed repair orders" />
            <SummaryCard icon={IndianRupee} label="Total Billing" value={formatCurrency(summary.totalAmount)} helper={`Avg billing ${formatCurrency(summary.avgBilling)}`} />
            <SummaryCard icon={XCircle} label="Cancelled" value={numberFormat(summary.cancelled)} helper={`${formatCurrency(summary.labourAmount)} labour / ${formatCurrency(summary.partsAmount)} parts`} />
          </section>
        )}

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1.5fr_repeat(5,minmax(0,1fr))]">
            <form onSubmit={submitSearch} className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                key={`hyundai-repair-search-${safeParam(searchParams, 'search')}`}
                name="search"
                defaultValue={safeParam(searchParams, 'search')}
                placeholder="Search RO, registration, VIN, advisor, model..."
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              />
              <Button type="submit" className="h-9 rounded-xl px-4 text-xs">Search</Button>
            </form>

            <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })} className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none">
              <option value="all">All statuses</option>
              {(data?.options.statuses || []).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={filters.workType} onChange={(event) => updateFilters({ workType: event.target.value })} className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none">
              <option value="all">All work types</option>
              {(data?.options.workTypes || []).map((workType) => <option key={workType} value={workType}>{workType}</option>)}
            </select>
            <select value={filters.advisor} onChange={(event) => updateFilters({ advisor: event.target.value })} className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none">
              <option value="all">All advisors</option>
              {(data?.options.advisors || []).map((advisor) => <option key={advisor} value={advisor}>{advisor}</option>)}
            </select>
            <input type="date" value={filters.startDate} onChange={(event) => updateFilters({ startDate: event.target.value })} className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none" />
            <input type="date" value={filters.endDate} onChange={(event) => updateFilters({ endDate: event.target.value })} className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none" />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold text-slate-500">
              Showing {numberFormat(data?.rows.length || 0)} of {numberFormat(pagination.totalRows)} repair orders
            </p>
            <Button type="button" variant="outline" onClick={clearFilters} className="h-10 rounded-2xl bg-white px-4">
              Clear Filters
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Repair Order Register</p>
              <h2 className="text-xl font-black text-slate-950">Hyundai repair order list</h2>
            </div>
            {isFetching && <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Loading fresh data</span>}
          </div>

          <div className="overflow-auto">
            <table className="min-w-[1500px] w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="bg-slate-950 text-white">
                  {['RO No', 'RO Date', 'Registration', 'Model', 'Work Type', 'Advisor', 'Technician', 'Status', 'RO Status', 'Labour', 'Parts', 'Total', 'Promise', 'Closing', 'Dealer'].map((heading) => (
                    <th key={heading} className="border border-slate-700 px-3 py-3 text-[11px] font-black uppercase tracking-[0.14em]">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showSkeleton ? (
                  <TableSkeleton />
                ) : data?.rows.length ? (
                  data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-200 align-top hover:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-950">{row.roNo}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{formatDate(row.roDate)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-950">{row.regNo}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">
                        <div className="max-w-[220px]">{row.model}</div>
                        <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{row.vin}</div>
                      </td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{row.workType}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{row.serviceAdvisor}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{row.technician}</td>
                      <td className="border border-slate-200 px-3 py-3">
                        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest', statusBadgeClass(row.status))}>
                          {row.status}
                        </span>
                      </td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">
                        <div>{row.newRoStatus}</div>
                        {row.delayReason && <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-rose-600">{row.delayReason}</div>}
                      </td>
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-950">{formatCurrency(row.labourAmount)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-950">{formatCurrency(row.partsAmount)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-black text-slate-950">{formatCurrency(row.totalAmount)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{formatDate(row.promiseDate)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{formatDate(row.closingDate)}</td>
                      <td className="border border-slate-200 px-3 py-3 font-bold text-slate-700">{row.dealerCode}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={15} className="border border-slate-200 bg-white px-4 py-14 text-center text-sm font-black text-slate-500">
                      No Hyundai repair orders match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-500">
              Page {numberFormat(pagination.page)} of {numberFormat(pagination.totalPages)} / {numberFormat(pagination.totalRows)} total
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-2xl bg-white px-4"
                disabled={pagination.page <= 1}
                onClick={() => updateFilters({ page: Math.max(1, pagination.page - 1) })}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-2xl bg-white px-4"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => updateFilters({ page: Math.min(pagination.totalPages, pagination.page + 1) })}
              >
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
    </MainLayout>
  )
}
