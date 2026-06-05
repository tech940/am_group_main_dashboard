'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'
import { DEFAULT_KIA_DEALER_CODE, KIA_BRANCH_DEALERS, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

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
  calendar: {
    month: string
    monthLabel: string
    startDate: string
    endDate: string
    days: CalendarDay[]
  }
}

const DASHBOARD_STALE_TIME_MS = 75 * 60 * 1000

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function buildQueryString(params: Record<string, string | number>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '') searchParams.set(key, String(value))
  })
  return searchParams.toString()
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

function monthShift(month: string, offset: number) {
  const [yearPart, monthPart] = month.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(yearPart, monthPart - 1 + offset, 1))
  return date.toISOString().slice(0, 7)
}

function statChipClass(tone: 'total' | 'open' | 'closed' | 'cancelled') {
  if (tone === 'open') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'closed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function SummaryPill({ label, value, tone = 'total' }: { label: string; value: number; tone?: 'total' | 'open' | 'closed' | 'cancelled' }) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest', statChipClass(tone))}>
      <span>{label}</span>
      <strong className="text-xs">{numberFormat(value)}</strong>
    </span>
  )
}

function CalendarSkeleton() {
  return (
    <>
      {Array.from({ length: 42 }).map((_, index) => (
        <div key={`service-appointment-calendar-skeleton-${index}`} className="min-h-[92px] rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="mx-auto h-6 w-14 animate-pulse rounded-full bg-slate-100" />
          <div className="mt-4 grid grid-cols-2 gap-1.5">
            {Array.from({ length: 4 }).map((__, chipIndex) => (
              <div key={`service-appointment-calendar-skeleton-chip-${index}-${chipIndex}`} className="h-7 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function CalendarDayCard({ day }: { day: CalendarDay }) {
  const hasAppointments = day.total > 0

  return (
    <div
      className={cn(
        'min-h-[92px] rounded-2xl border p-2 shadow-sm transition',
        day.inCurrentMonth
          ? 'border-slate-200 bg-white hover:border-[var(--dashboard-primary-border)] hover:shadow-md'
          : 'border-slate-100 bg-slate-50 text-slate-300'
      )}
    >
      <div className="flex justify-center">
        <span
          className={cn(
            'grid h-7 min-w-9 place-items-center rounded-full px-2 text-[12px] font-black leading-none',
            day.inCurrentMonth
              ? hasAppointments
                ? 'bg-[var(--dashboard-action-bg)] text-white'
                : 'bg-slate-100 text-slate-800'
              : 'bg-white text-slate-300'
          )}
        >
          {day.day}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {([
          ['BK', day.total, 'total' as const],
          ['OP', day.open, 'open' as const],
          ['CL', day.closed, 'closed' as const],
          ['CN', day.cancelled, 'cancelled' as const],
        ] satisfies Array<[string, number, 'total' | 'open' | 'closed' | 'cancelled']>).map(([label, value, tone]) => (
          <span
            key={`${day.date}-${label}`}
            title={`${value} ${label}`}
            className={cn('min-w-0 rounded-lg border px-1.5 py-1.5 text-center text-[9px] font-black uppercase leading-none', statChipClass(tone))}
          >
            {numberFormat(value)} {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ServiceAppointmentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [calendarMonth, setCalendarMonth] = useState(currentMonth)
  const [selectedDealerCode, setSelectedDealerCode] = useState(() => normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSelectedDealerCode(normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE)
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [searchParams])

  const queryString = useMemo(() => buildQueryString({
    dealer_code: selectedDealerCode,
    month: calendarMonth,
    refresh: refreshNonce || '',
  }), [calendarMonth, refreshNonce, selectedDealerCode])

  const { data, error, isLoading, isFetching } = useQuery<AppointmentPayload>({
    queryKey: ['service-appointment-calendar', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/service-appointment?${queryString}`, { cache: 'no-store' })
      logApiTimings(response, 'service-appointment')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Service Appointment')
      return payload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_STALE_TIME_MS,
  })

  const handleDealerChange = (dealerCode: string) => {
    const nextDealerCode = normalizeKiaDealerCode(dealerCode) || DEFAULT_KIA_DEALER_CODE
    setSelectedDealerCode(nextDealerCode)
    const params = new URLSearchParams(searchParams.toString())
    params.set('dealer_code', nextDealerCode)
    router.replace(`/brands/kia/service-appointment?${params.toString()}`, { scroll: false })
  }

  const summary = data?.summary || { total: 0, open: 0, closed: 0, cancelled: 0, advisors: 0 }
  const days = data?.calendar.days || []
  const showSkeleton = isLoading || isFetching

  return (
    <MainLayout title="Service Appointment" subtitle="AM Kia appointment calendar">
      <div className="space-y-4">
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white p-5 shadow-2xl shadow-slate-900/5">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,var(--dashboard-primary-soft),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Service Appointment Calendar</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">{data?.calendar.monthLabel || calendarMonth}</h1>
                <p className="mt-2 text-xs font-black uppercase tracking-widest text-slate-500">
                  Source last updated: {formatDateTime(data?.meta.sourceUpdatedAt)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
              <Button type="button" onClick={() => setCalendarMonth(monthShift(calendarMonth, -1))} className="app-outline-action h-11 rounded-2xl px-3">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={() => setCalendarMonth(monthShift(calendarMonth, 1))} className="app-outline-action h-11 rounded-2xl px-3">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={() => setRefreshNonce(Date.now())} className="app-outline-action h-11 rounded-2xl px-4" disabled={isFetching}>
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

        <section className="solid-calendar-surface overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm" style={{ backgroundColor: '#ffffff' }}>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Current Month View</p>
              <h2 className="text-2xl font-black text-slate-950">{data?.calendar.monthLabel || calendarMonth}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SummaryPill label="Booked" value={summary.total} />
              <SummaryPill label="Open" value={summary.open} tone="open" />
              <SummaryPill label="Closed" value={summary.closed} tone="closed" />
              <SummaryPill label="Cancelled" value={summary.cancelled} tone="cancelled" />
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="rounded-xl bg-slate-950 px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-white">
                {day}
              </div>
            ))}
            {showSkeleton ? (
              <CalendarSkeleton />
            ) : (
              days.map((day) => <CalendarDayCard key={day.date} day={day} />)
            )}
          </div>
        </section>
      </div>
    </MainLayout>
  )
}
