'use client'

import * as React from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, RefreshCw, RotateCcw } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { FUEL_REPORTS } from '@/lib/fuel-management/reports'
import type { FuelLifecycle, FuelManagementResponse, FuelQualityKey } from '@/lib/fuel-management/types'
import {
  PERIOD_OPTIONS,
  activeFilterCount,
  downloadFuelReport,
  fetchFuel,
  filterParams,
  initialFilters,
  presetRange,
  type FilterState,
  type PeriodPreset,
} from './fuel-data'
import { EmptyState, FilterSelect, FuelTokens, Loading, Segmented, Skeleton, fmtRange, fmtWhen } from './fuel-ui'
import { HeadlineStrip } from './headline-strip'
import { OverviewView } from './overview-view'
import { RecordsView } from './records-view'
import { VehiclesView } from './vehicles-view'
import { ExceptionsView } from './exceptions-view'
import { ReportsView } from './reports-view'
import { QualityView } from './quality-view'
import { SettingsView } from './settings-view'
import { RecordDrawer } from './record-drawer'
import { VehicleDrawer } from './vehicle-drawer'

export type FuelTab = 'overview' | 'records' | 'vehicles' | 'exceptions' | 'reports' | 'quality' | 'settings'

export type DrillTarget = { kind: 'record'; id: string } | { kind: 'vehicle'; key: string }

/** How a view asks the shell to move somewhere. */
export type FuelNavigate = {
  toTab: (tab: FuelTab, options?: { recordState?: FuelLifecycle | 'open_exceptions' | ''; quality?: FuelQualityKey | ''; exceptionKey?: string }) => void
  openRecord: (id: string) => void
  openVehicle: (key: string) => void
  /** Show every record for one vehicle: sets the vehicle filter and opens the record list. */
  recordsForVehicle: (key: string) => void
  download: (reportId: string) => void
}

const TAB_ORDER: FuelTab[] = ['overview', 'records', 'vehicles', 'exceptions', 'reports', 'quality', 'settings']
const TAB_STORAGE_KEY = 'fuel-management:tab'

/**
 * Fuel Management — the control centre for fuel spend, volume, vehicles, usage, efficiency and accountability.
 *
 * Every figure comes from the server (GET /api/fuel-management and its sub-routes), which aggregates one cached
 * ledger joining fuel requests, demo gate passes, LocoNav trips and the configured benchmarks. This file holds
 * the page frame: period and filters, the headline strip, the tabs, and the drill-down drawers.
 */
export function FuelManagementClient() {
  const [filters, setFilters] = React.useState<FilterState>(initialFilters)
  const [tab, setTab] = React.useState<FuelTab>('overview')
  const [recordState, setRecordState] = React.useState<FuelLifecycle | 'open_exceptions' | ''>('')
  const [qualityFilter, setQualityFilter] = React.useState<FuelQualityKey | ''>('')
  const [focusException, setFocusException] = React.useState<string>('')
  const [drill, setDrill] = React.useState<DrillTarget[]>([])
  const opener = React.useRef<HTMLElement | null>(null)
  const filterBar = React.useRef<HTMLDivElement | null>(null)
  const tabRefs = React.useRef<Partial<Record<FuelTab, HTMLButtonElement | null>>>({})

  // The last tab is a per-viewer convenience only; the page works the same without it.
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(TAB_STORAGE_KEY) as FuelTab | null
      if (saved && TAB_ORDER.includes(saved)) setTab(saved)
    } catch {
      /* storage unavailable */
    }
  }, [])
  const changeTab = React.useCallback((next: FuelTab) => {
    setTab(next)
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const { from, to, branch, brand, purpose, department, energy, fleet, vehicle } = filters
  const query = useQuery({
    queryKey: ['fuel-management', 'overview', from, to, branch, brand, purpose, department, energy, fleet, vehicle],
    queryFn: () => fetchFuel<FuelManagementResponse>(`/api/fuel-management?${filterParams(filters)}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  // With keepPreviousData a failed refetch still has figures — for the PREVIOUS selection. Say so.
  const stale = query.isError && Boolean(data)

  const exportQuery = filterParams(filters)
  const download = React.useCallback((reportId: string) => {
    const title = FUEL_REPORTS.find((r) => r.id === reportId)?.title ?? 'Report'
    toast({ title: `Preparing ${title}…` })
    downloadFuelReport(`/api/fuel-management/export?report=${reportId}&${exportQuery}`)
      .catch((error) => toast({ title: `${title} could not be downloaded`, description: error instanceof Error ? error.message : undefined, variant: 'error' }))
  }, [exportQuery])

  const drillDepth = React.useRef(0)
  React.useEffect(() => {
    drillDepth.current = drill.length
  }, [drill])
  const openDrill = React.useCallback((target: DrillTarget) => {
    // Remember what opened the FIRST drawer; a drawer opened from a drawer returns to the same place.
    if (drillDepth.current === 0) opener.current = document.activeElement as HTMLElement | null
    drillDepth.current += 1
    setDrill((stack) => [...stack, target])
  }, [])
  const closeDrill = React.useCallback(() => {
    setDrill([])
    // Back to what opened the first drawer, once the sheet has gone.
    window.setTimeout(() => {
      const el = opener.current
      if (el && document.contains(el)) el.focus()
      opener.current = null
    }, 0)
  }, [])

  const navigate: FuelNavigate = React.useMemo(() => ({
    toTab: (next, options) => {
      if (options?.recordState !== undefined) setRecordState(options.recordState)
      if (options?.quality !== undefined) setQualityFilter(options.quality)
      if (options?.exceptionKey !== undefined) setFocusException(options.exceptionKey)
      changeTab(next)
      setDrill([])
      opener.current = null
    },
    openRecord: (id) => openDrill({ kind: 'record', id }),
    openVehicle: (key) => openDrill({ kind: 'vehicle', key }),
    recordsForVehicle: (key) => {
      setFilters((f) => ({ ...f, vehicle: key }))
      setRecordState('')
      setQualityFilter('')
      changeTab('records')
      setDrill([])
      opener.current = null
    },
    download,
  }), [changeTab, openDrill, download])

  const setPreset = (preset: PeriodPreset) => {
    if (preset === 'custom') {
      setFilters((f) => ({ ...f, preset }))
      return
    }
    setFilters((f) => ({ ...f, preset, ...presetRange(preset) }))
  }
  // A typed start after the end (or the reverse) moves the other end, so the period is always a real one.
  const setFrom = (value: string) => setFilters((f) => ({ ...f, from: value, to: value > f.to ? value : f.to }))
  const setTo = (value: string) => setFilters((f) => ({ ...f, to: value, from: value < f.from ? value : f.from }))
  const setFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters((f) => ({ ...f, [key]: value }))
  const clearFilters = () => {
    setFilters((f) => ({ ...f, branch: '', brand: '', purpose: '', department: '', energy: '', fleet: '', vehicle: '' }))
    // The button removes itself; keep the keyboard in the filter bar.
    window.setTimeout(() => filterBar.current?.querySelector<HTMLElement>('button, select')?.focus(), 0)
  }

  const options = data?.options
  const filterCount = activeFilterCount(filters)
  const current = drill.at(-1) ?? null

  const tabs: { value: FuelTab; label: string; count?: number | null }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'records', label: 'Fuel records' },
    { value: 'vehicles', label: 'Vehicles', count: data?.headline.vehiclesNeedingAttention ?? null },
    { value: 'exceptions', label: 'Exceptions', count: data?.headline.exceptions.open ?? null },
    { value: 'reports', label: 'Reports' },
    { value: 'quality', label: 'Data quality', count: data ? data.quality.filter((q) => q.count > 0).length : null },
    { value: 'settings', label: 'Benchmarks' },
  ]

  // Arrow keys move between tabs; only the selected tab is a Tab stop.
  const onTabKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = TAB_ORDER.indexOf(tab)
    let next: FuelTab | null = null
    if (event.key === 'ArrowRight') next = TAB_ORDER[(index + 1) % TAB_ORDER.length]
    else if (event.key === 'ArrowLeft') next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]
    else if (event.key === 'Home') next = TAB_ORDER[0]
    else if (event.key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1]
    if (!next) return
    event.preventDefault()
    changeTab(next)
    tabRefs.current[next]?.focus()
  }

  const needsData = (node: React.ReactNode) => {
    if (data) return node
    if (query.isError) {
      return (
        <EmptyState
          title="This view needs the fuel figures, which could not be loaded"
          action={<RetryButton onClick={() => query.refetch()} />}
        >
          {query.error instanceof Error ? query.error.message : null}
        </EmptyState>
      )
    }
    return <ViewSkeleton />
  }

  return (
    <MainLayout title="Fuel Management" subtitle="Fleet fuel spend, usage efficiency and operational accountability">
      <FuelTokens />
      <div className="fm mx-auto max-w-[1520px] space-y-5 pb-16">
        {/* ── Period, actions ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 pt-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 font-mono">
                {fmtRange(from, to)}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                Live Audit
              </span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500" aria-live="polite">
              {data ? <>Compared with <span className="font-semibold text-slate-700">{fmtRange(data.previous.from, data.previous.to)}</span></> : 'Loading period data…'}
              {query.isFetching && data && <span className="ml-2 text-teal-700 font-bold">· Updating…</span>}
            </p>
          </div>

          <div className="fm-noprint flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => query.refetch()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900 shadow-2xs active:scale-98 cursor-pointer"
            >
              <RefreshCw aria-hidden className={cn('size-3.5', query.isFetching && 'animate-spin motion-reduce:animate-none')} />
              <span>Refresh</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900 shadow-2xs active:scale-98 cursor-pointer"
                >
                  <Download aria-hidden className="size-3.5" />
                  <span>Export</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl p-1.5 shadow-xl border border-slate-200">
                <DropdownMenuLabel className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-2.5 py-1.5">
                  Excel Reports
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1" />
                {FUEL_REPORTS.map((report) => (
                  <DropdownMenuItem key={report.id} className="text-xs font-semibold rounded-xl px-2.5 py-2 cursor-pointer" onSelect={() => download(report.id)}>
                    {report.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Link
              href="/fuel-approvals"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white transition-all hover:bg-slate-800 shadow-xs active:scale-98 cursor-pointer"
            >
              <span>Fuel Approvals</span>
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* ── Period and filters ── */}
        <div ref={filterBar} className="fm-noprint flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-white p-2.5 shadow-2xs">
          <Segmented value={filters.preset} onChange={setPreset} options={PERIOD_OPTIONS} label="Period" />
          {filters.preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor="fm-from">From</label>
              <input
                id="fm-from"
                type="date"
                value={from}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-2xs"
              />
              <span className="text-xs font-bold text-slate-400">to</span>
              <label className="sr-only" htmlFor="fm-to">To</label>
              <input
                id="fm-to"
                type="date"
                value={to}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-2xs"
              />
            </div>
          )}
          <span aria-hidden className="mx-1 hidden h-6 w-px bg-slate-200 lg:block" />
          {options && (
            <>
              {(options.branches.length > 1 || branch) && (
                <FilterSelect label="Branch" value={branch} onChange={(v) => setFilter('branch', v)} options={options.branches} allLabel="All branches" />
              )}
              {(options.brands.length > 1 || brand) && (
                <FilterSelect label="Brand" value={brand} onChange={(v) => setFilter('brand', v)} options={options.brands} allLabel="All brands" />
              )}
              <FilterSelect label="Purpose" value={purpose} onChange={(v) => setFilter('purpose', v)} options={options.purposes} allLabel="All purposes" />
              {(options.departments.length > 1 || department) && (
                <FilterSelect label="Department" value={department} onChange={(v) => setFilter('department', v)} options={options.departments} allLabel="All departments" />
              )}
              {(options.energies.length > 1 || energy) && (
                <FilterSelect
                  label="Fuel type"
                  value={energy}
                  onChange={(v) => setFilter('energy', v as FilterState['energy'])}
                  options={options.energies}
                  allLabel="All fuel types"
                />
              )}
              <FilterSelect
                label="Fleet"
                value={fleet}
                onChange={(v) => setFilter('fleet', v as FilterState['fleet'])}
                options={[{ value: 'demo', label: 'Demo cars' }, { value: 'other', label: 'Other fuel' }]}
                allLabel="All vehicles"
              />
              {(options.vehicles.length > 0 || vehicle) && (
                <FilterSelect
                  label="Vehicle"
                  value={vehicle}
                  onChange={(v) => setFilter('vehicle', v)}
                  options={vehicle && !options.vehicles.some((o) => o.value === vehicle)
                    ? [{ value: vehicle, label: data?.vehicles.find((v) => v.key === vehicle)?.label ?? vehicle }, ...options.vehicles]
                    : options.vehicles}
                  allLabel="Any vehicle"
                />
              )}
            </>
          )}
          {filterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <RotateCcw aria-hidden className="size-3.5" />
              Reset ({filterCount})
            </button>
          )}
        </div>

        {/* ── Headline Metric Strip ── */}
        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold text-amber-800">
              These figures could not be updated for the selected period — showing previous selection.
              {query.error instanceof Error ? ` ${query.error.message}` : ''}
            </p>
            <RetryButton onClick={() => query.refetch()} />
          </div>
        )}
        {query.isError && !data ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
            <p className="text-xs font-bold text-rose-800">
              {query.error instanceof Error ? query.error.message : 'Fuel figures could not be loaded.'}
            </p>
            <RetryButton onClick={() => query.refetch()} />
          </div>
        ) : data ? (
          <div
            aria-busy={query.isFetching || undefined}
            className={cn('fm-noprint transition-opacity duration-150', (query.isFetching && query.isPlaceholderData) || stale ? 'opacity-60' : '')}
          >
            <HeadlineStrip data={data} navigate={navigate} />
          </div>
        ) : (
          <Loading label="Loading the fuel figures"><Skeleton className="h-[140px] w-full rounded-2xl" /></Loading>
        )}

        {/* ── Modern Segmented Tab Ribbon ── */}
        <div className="fm-noprint fm-scroll -mx-1 overflow-x-auto px-1 py-0.5">
          <div role="tablist" aria-label="Fuel Management sections" className="inline-flex min-w-max items-center gap-1 p-1 bg-slate-100/90 rounded-2xl border border-slate-200/80 shadow-2xs">
            {tabs.map((item) => {
              const active = item.value === tab
              return (
                <button
                  key={item.value}
                  ref={(el) => { tabRefs.current[item.value] = el }}
                  type="button"
                  role="tab"
                  id={`fm-tab-${item.value}`}
                  aria-selected={active}
                  aria-controls={active ? `fm-panel-${item.value}` : undefined}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => changeTab(item.value)}
                  className={cn(
                    'fm-inset-focus inline-flex h-9 items-center gap-2 px-3.5 sm:px-4 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer active:scale-98',
                    active
                      ? 'bg-white text-slate-950 shadow-xs border border-slate-200/60 font-black'
                      : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50',
                  )}
                >
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count !== null && item.count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10.5px] font-black tabular-nums',
                        active ? 'bg-slate-100 text-slate-900' : 'bg-slate-200/70 text-slate-600',
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div role="tabpanel" id={`fm-panel-${tab}`} aria-labelledby={`fm-tab-${tab}`} aria-busy={query.isFetching || undefined}>
          {tab === 'overview' && needsData(data && <OverviewView data={data} navigate={navigate} />)}
          {tab === 'records' && (
            <RecordsView filters={filters} state={recordState} onStateChange={setRecordState} quality={qualityFilter} onQualityChange={setQualityFilter} navigate={navigate} />
          )}
          {tab === 'vehicles' && needsData(data && <VehiclesView data={data} navigate={navigate} />)}
          {tab === 'exceptions' && needsData(data && (
            <ExceptionsView data={data} navigate={navigate} focusKey={focusException} onFocusHandled={() => setFocusException('')} />
          ))}
          {tab === 'reports' && needsData(data && <ReportsView data={data} navigate={navigate} />)}
          {tab === 'quality' && needsData(data && <QualityView data={data} navigate={navigate} />)}
          {tab === 'settings' && <SettingsView />}
        </div>

        {data && (
          <p className="text-[11.5px] text-slate-500">
            Figures as of {fmtWhen(data.generatedAt)}, refreshed at most once a minute and whenever a fuel record changes.
          </p>
        )}
      </div>

      <RecordDrawer
        target={current?.kind === 'record' ? current.id : null}
        filters={filters}
        canGoBack={drill.length > 1}
        onBack={() => setDrill((stack) => stack.slice(0, -1))}
        onClose={closeDrill}
        navigate={navigate}
      />
      <VehicleDrawer
        target={current?.kind === 'vehicle' ? current.key : null}
        filters={filters}
        canGoBack={drill.length > 1}
        onBack={() => setDrill((stack) => stack.slice(0, -1))}
        onClose={closeDrill}
        navigate={navigate}
      />
    </MainLayout>
  )
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900"
    >
      Try again
    </button>
  )
}

function ViewSkeleton() {
  return (
    <Loading>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </Loading>
  )
}
