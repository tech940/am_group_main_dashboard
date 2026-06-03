'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'
import { DEFAULT_KIA_DEALER_CODE, KIA_BRANCH_DEALERS, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

type AppointmentStatusFilter = 'all' | 'open' | 'closed' | 'cancelled'

type AppointmentRow = {
  id: string
  appointmentNo: string
  appointmentDate?: string | null
  appointmentDoneOn?: string | null
  status: string
  statusGroup: 'open' | 'closed' | 'cancelled'
  customer: string
  mobile: string
  model: string
  regNo: string
  vin: string
  workType: string
  serviceAdvisor: string
  cce: string
  pickUp: string
  source: string
  customerDemand: string
  dealerCode: string
  uploadedAt?: string | null
}

type CalendarDay = {
  date: string
  day: number
  inCurrentMonth: boolean
  total: number
  open: number
  closed: number
  cancelled: number
  other: number
}

type AppointmentPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    dealerCode: string
    branchLabel: string
    warning?: string
  }
  summary: {
    total: number
    open: number
    closed: number
    cancelled: number
    advisors: number
  }
  rows: AppointmentRow[]
  calendar: {
    month: string
    monthLabel: string
    startDate: string
    endDate: string
    days: CalendarDay[]
  }
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
  options: {
    statuses: AppointmentStatusFilter[]
  }
}

const DASHBOARD_STALE_TIME_MS = 75 * 60 * 1000
const PAGE_SIZE = 10

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function buildQueryString(params: Record<string, string | number>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== 'all') searchParams.set(key, String(value))
  })
  return searchParams.toString()
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
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function numberFormat(value: unknown) {
  const parsed = Number(value || 0)
  return new Intl.NumberFormat('en-IN').format(Number.isFinite(parsed) ? parsed : 0)
}

function statusLabel(status: AppointmentStatusFilter | string) {
  if (status === 'all') return 'All statuses'
  return status.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusBadgeClass(statusGroup: string) {
  if (statusGroup === 'closed') return 'border-emerald-200 bg-white text-emerald-700'
  if (statusGroup === 'cancelled') return 'border-rose-200 bg-white text-rose-700'
  return 'border-amber-200 bg-white text-amber-700'
}

function monthShift(month: string, offset: number) {
  const [yearPart, monthPart] = month.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(yearPart, monthPart - 1 + offset, 1))
  return date.toISOString().slice(0, 7)
}

function SummaryCard({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{numberFormat(value)}</p>
      <p className="mt-1 text-xs font-bold text-slate-500">{helper}</p>
    </div>
  )
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, rowIndex) => (
        <tr key={`appointment-skeleton-${rowIndex}`} className="border-b border-slate-200">
          {Array.from({ length: 12 }).map((__, columnIndex) => (
            <td key={`appointment-skeleton-${rowIndex}-${columnIndex}`} className="border border-slate-200 bg-white px-3 py-4">
              <div className={cn('h-4 animate-pulse rounded-full bg-slate-200', columnIndex % 3 === 0 ? 'w-24' : 'w-16')} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function CalendarModal({
  data,
  month,
  loading,
  onClose,
  onMonthChange,
}: {
  data?: AppointmentPayload
  month: string
  loading: boolean
  onClose: () => void
  onMonthChange: (month: string) => void
}) {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousRootOverflow
    }
  }, [])

  const days = data?.calendar.days || []
  const summary = data?.summary || { total: 0, open: 0, closed: 0, cancelled: 0, advisors: 0 }

  return (
    <div
      className="solid-calendar-surface fixed inset-0 z-[9999] h-[100dvh] max-h-[100dvh] overflow-hidden bg-white p-2"
      style={{ backgroundColor: '#ffffff' }}
      role="dialog"
      aria-modal="true"
    >
      <div className="solid-calendar-surface flex h-full w-full flex-col overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-2xl" style={{ backgroundColor: '#ffffff' }}>
        <div className="solid-calendar-surface flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Service Appointment Calendar</p>
              <h2 className="text-xl font-black leading-tight text-slate-950">{data?.calendar.monthLabel || month}</h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" onClick={() => onMonthChange(monthShift(month, -1))} className="app-outline-action h-10 rounded-xl px-3">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" onClick={() => onMonthChange(monthShift(month, 1))} className="app-outline-action h-10 rounded-xl px-3">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600">
              Total {numberFormat(summary.total)}
            </span>
            <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-amber-700">
              Open {numberFormat(summary.open)}
            </span>
            <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-700">
              Closed {numberFormat(summary.closed)}
            </span>
            <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-rose-700">
              Cancelled {numberFormat(summary.cancelled)}
            </span>
            <Button type="button" onClick={onClose} className="app-outline-action h-10 rounded-2xl px-4">
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        <div className="solid-calendar-surface min-h-0 flex-1 bg-white p-2" style={{ backgroundColor: '#ffffff' }}>
          <div
            className="solid-calendar-surface grid h-full min-h-0 grid-cols-7 overflow-hidden rounded-2xl border border-slate-200 bg-white"
            style={{ backgroundColor: '#ffffff', gridTemplateRows: '26px repeat(6, minmax(0, 1fr))' }}
          >
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="border-r border-white/10 bg-slate-950 px-2 py-1 text-center text-[10px] font-black uppercase tracking-widest text-white last:border-r-0">
                {day}
              </div>
            ))}
            {loading && days.length === 0 ? (
              Array.from({ length: 42 }).map((_, index) => (
                <div key={`appointment-calendar-skeleton-${index}`} className="border-b border-r border-slate-100 bg-white p-1.5" style={{ backgroundColor: '#ffffff' }}>
                  <div className="h-full animate-pulse rounded-xl bg-slate-100" />
                </div>
              ))
            ) : (
              days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    'min-h-0 overflow-hidden border-b border-r border-slate-100 bg-white p-1.5 last:border-r-0',
                    !day.inCurrentMonth && 'bg-slate-50 text-slate-300'
                  )}
                  style={{ backgroundColor: day.inCurrentMonth ? '#ffffff' : '#f8fafc' }}
                >
                  <div className="flex h-full flex-col items-center justify-start gap-1.5" style={{
                    border: "1px solid #333",
                    padding: "5px",
                    borderRadius: "5px",
                    background: "#e1d6d6"
                  }}>
                    <span
                      className={cn(
                        'grid h-6 min-w-6 place-items-center rounded-full border px-2 text-[11px] font-black leading-none',
                        day.inCurrentMonth
                          ? 'border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] text-slate-950'
                          : 'border-slate-200 bg-white text-slate-300'
                      )}
                    >
                      {day.day}
                    </span>
                    <div className="grid w-full max-w-[132px] grid-cols-2 gap-1 text-[8px] font-black uppercase leading-none">
                      <span title={`${day.total} booked`} className="min-w-0 truncate rounded border border-slate-200 bg-white px-1 py-1 text-center text-slate-700">{day.total} Bk</span>
                      <span title={`${day.open} open`} className="min-w-0 truncate rounded border border-amber-200 bg-white px-1 py-1 text-center text-amber-700">{day.open} Op</span>
                      <span title={`${day.closed} closed`} className="min-w-0 truncate rounded border border-emerald-200 bg-white px-1 py-1 text-center text-emerald-700">{day.closed} Cl</span>
                      <span title={`${day.cancelled} cancelled`} className="min-w-0 truncate rounded border border-rose-200 bg-white px-1 py-1 text-center text-rose-700">{day.cancelled} Cn</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ServiceAppointmentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AppointmentStatusFilter>('all')
  const [page, setPage] = useState(1)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(currentMonth)
  const [selectedDealerCode, setSelectedDealerCode] = useState(() => normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSelectedDealerCode(normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [searchParams])

  const queryString = useMemo(() => buildQueryString({
    dealer_code: selectedDealerCode,
    month: calendarMonth,
    page,
    pageSize: PAGE_SIZE,
    search,
    status,
  }), [calendarMonth, page, search, selectedDealerCode, status])

  const { data, error, isLoading, isFetching, refetch } = useQuery<AppointmentPayload>({
    queryKey: ['service-appointment', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/service-appointment?${queryString}`)
      logApiTimings(response, 'service-appointment')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Service Appointment')
      return payload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const handleDealerChange = (dealerCode: string) => {
    const nextDealerCode = normalizeKiaDealerCode(dealerCode) || DEFAULT_KIA_DEALER_CODE
    setSelectedDealerCode(nextDealerCode)
    setPage(1)
    const params = new URLSearchParams(searchParams.toString())
    params.set('dealer_code', nextDealerCode)
    router.replace(`/brands/kia/service-appointment?${params.toString()}`, { scroll: false })
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const handleStatus = (value: AppointmentStatusFilter) => {
    setStatus(value)
    setPage(1)
  }

  const rows = data?.rows || []
  const pagination = data?.pagination

  return (
    <MainLayout title="Service Appointment" subtitle="AM Kia appointment register and calendar">
      <div className="space-y-6">
        {calendarOpen && (
          <CalendarModal
            data={data}
            month={calendarMonth}
            loading={isLoading || isFetching}
            onClose={() => setCalendarOpen(false)}
            onMonthChange={setCalendarMonth}
          />
        )}

        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white p-6 shadow-2xl shadow-slate-900/5">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,var(--dashboard-primary-soft),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--dashboard-action-bg)]">
                <CalendarDays className="h-3.5 w-3.5" />
                Service Control
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Service Appointment</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-slate-600">
                Track booked, open, closed, and cancelled AM Kia service appointments branch-wise, with a month calendar for daily appointment pressure.
              </p>
              <p className="mt-2 text-xs font-black uppercase tracking-widest text-slate-500">
                Source last updated: {formatDateTime(data?.meta.sourceUpdatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Service Appointment branch filter">
                {KIA_BRANCH_DEALERS.map((branch) => {
                  const isActive = selectedDealerCode === branch.dealerCode
                  return (
                    <button
                      key={branch.dealerCode}
                      type="button"
                      onClick={() => handleDealerChange(branch.dealerCode)}
                      className={cn(
                        'rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition',
                        isActive ? 'bg-[var(--dashboard-action-bg)] text-white shadow-sm' : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      )}
                    >
                      {branch.label}
                    </button>
                  )
                })}
              </div>
              <Button type="button" onClick={() => setCalendarOpen(true)} className="app-primary-action rounded-2xl px-4 py-2">
                <CalendarDays className="mr-2 h-4 w-4" />
                Calendar View
              </Button>
              <Button type="button" onClick={() => void refetch()} className="app-outline-action rounded-2xl px-4 py-2" disabled={isFetching}>
                <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        {data?.meta.warning && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            {data.meta.warning}
          </section>
        )}

        {error && (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-900">
            {error instanceof Error ? error.message : 'Service Appointment data could not be loaded.'}
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Booked" value={data?.summary.total || 0} helper="Total appointments" />
          <SummaryCard label="Open" value={data?.summary.open || 0} helper="Pending / active" />
          <SummaryCard label="Closed" value={data?.summary.closed || 0} helper="Completed appointments" />
          <SummaryCard label="Cancelled" value={data?.summary.cancelled || 0} helper="Cancelled appointments" />
          <SummaryCard label="Advisors" value={data?.summary.advisors || 0} helper="Active advisor count" />
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder="Search customer, mobile, vehicle, advisor, appointment..."
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-[var(--dashboard-action-bg)] focus:ring-4 focus:ring-[var(--dashboard-primary-soft)]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'open', 'closed', 'cancelled'] as AppointmentStatusFilter[]).map((item) => {
                const active = status === item
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => handleStatus(item)}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-[11px] font-black uppercase tracking-widest transition',
                      active
                        ? 'border-[var(--dashboard-action-bg)] bg-[var(--dashboard-action-bg)] text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-[var(--dashboard-primary-border)] hover:text-slate-950'
                    )}
                  >
                    {statusLabel(item)}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Appointment Register</p>
              <h2 className="text-2xl font-black text-slate-950">Service appointment list</h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">
              <Clock className="h-4 w-4" />
              {data?.meta.branchLabel || 'Jammu'}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-center text-[12px] font-bold text-slate-800">
              <thead>
                <tr className="bg-slate-950 text-white">
                  {[
                    'Appointment',
                    'Date',
                    'Status',
                    'Customer',
                    'Mobile',
                    'Model',
                    'Reg No',
                    'Work Type',
                    'Advisor',
                    'CCE',
                    'Pick Up',
                    'Demand',
                  ].map((heading) => (
                    <th key={heading} className="whitespace-nowrap border border-white/10 px-3 py-3 text-[10px] font-black uppercase tracking-widest">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(isLoading || (isFetching && rows.length === 0)) ? (
                  <TableSkeleton />
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="border border-slate-200 bg-white px-4 py-16 text-center text-sm font-black text-slate-500">
                      No service appointments match this view.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-200 bg-white align-middle">
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3 text-slate-950">{row.appointmentNo}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{formatDate(row.appointmentDate)}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">
                        <span className={cn('inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest', statusBadgeClass(row.statusGroup))}>
                          {row.status}
                        </span>
                      </td>
                      <td className="min-w-[150px] border border-slate-200 px-3 py-3 text-left">
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                          <span>{row.customer}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.mobile}</td>
                      <td className="min-w-[180px] border border-slate-200 px-3 py-3">{row.model}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.regNo}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.workType}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.serviceAdvisor}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.cce}</td>
                      <td className="whitespace-nowrap border border-slate-200 px-3 py-3">{row.pickUp}</td>
                      <td className="min-w-[220px] border border-slate-200 px-3 py-3 text-left">{row.customerDemand}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">
              Showing {numberFormat(rows.length)} of {numberFormat(pagination?.totalRows || 0)} appointments
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="app-outline-action rounded-2xl px-4 py-2"
                disabled={!pagination || pagination.page <= 1 || isFetching}
              >
                Prev
              </Button>
              <span className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700">
                Page {pagination?.page || 1} / {pagination?.totalPages || 1}
              </span>
              <Button
                type="button"
                onClick={() => setPage((value) => Math.min(pagination?.totalPages || 1, value + 1))}
                className="app-outline-action rounded-2xl px-4 py-2"
                disabled={!pagination || pagination.page >= pagination.totalPages || isFetching}
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
