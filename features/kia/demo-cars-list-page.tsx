'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Car,
  Clock,
  MapPin,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logApiTimings } from '@/lib/api/client-timing'

type DemoCarsLocation = 'all' | 'jammu' | 'udhampur'

type DemoCarRow = {
  id: string
  vehicleKey: string
  vin: string
  model: string
  variant: string
  color: string
  name?: string | null
  mainDealer?: string | null
  transporterName?: string | null
  invoiceDate?: string | null
  amount?: string | null
  retailDate?: string | null
  age?: number | null
  registrationNumber?: string | null
  billingDealerCode: string
  location: string
  trackerStatus?: 'installed' | 'not_installed' | null
  serviceDate?: string | null
  currentReadingKms?: number | string | null
  onRoadPrice?: number | string | null
  vehicleStatus?: 'active' | 'sold' | null
  detailsUpdatedBy?: string | null
  detailsUpdatedAt?: string | null
}

type DisplayColumn = {
  key: keyof DemoCarRow
  label: string
  kind?: 'text' | 'date' | 'amount' | 'age'
}

type DemoCarsPayload = {
  meta: {
    source: string
    filterRule: string
    detailsSource: string
    detailsTableReady: boolean
    generatedAt: string
    sourceUpdatedAt: string | null
    warning?: string
  }
  columns: DisplayColumn[]
  summary: {
    total: number
    jammu: number
    udhampur: number
    withDetails: number
  }
  rows: DemoCarRow[]
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
  options: {
    locations: DemoCarsLocation[]
  }
}

const DASHBOARD_STALE_TIME_MS = 30 * 60 * 1000

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

function formatAmount(value?: string | number | null) {
  if (value === null || value === undefined || value === '' || value === '-') return '-'
  const parsed = Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(parsed)) return String(value)
  return `Rs ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(parsed)}`
}

function formatCell(row: DemoCarRow, column: DisplayColumn) {
  const value = row[column.key]
  if (column.kind === 'date') return formatDate(value as string | null)
  if (column.kind === 'amount') return formatAmount(value as string | number | null)
  if (column.kind === 'age') return typeof value === 'number' ? `${value}D` : '-'
  return value === null || value === undefined || value === '' ? '-' : String(value)
}

function labelizeStatus(value?: string | null) {
  if (!value) return '-'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function locationLabel(location: DemoCarsLocation) {
  if (location === 'jammu') return 'Jammu'
  if (location === 'udhampur') return 'Udhampur'
  return 'All'
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

function TableSkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 10 }).map((_, rowIndex) => (
        <tr key={`demo-car-table-skeleton-${rowIndex}`} className="border-b border-slate-200/80">
          {Array.from({ length: columnCount }).map((__, columnIndex) => (
            <td
              key={`demo-car-table-skeleton-${rowIndex}-${columnIndex}`}
              className={cn(
                'border border-slate-200 bg-white px-4 py-4',
                columnIndex === columnCount - 1 && 'sticky right-0 z-10 shadow-[-10px_0_18px_rgba(15,23,42,0.08)]'
              )}
            >
              <div
                className={cn(
                  'mx-auto h-4 animate-pulse rounded-full bg-slate-200',
                  columnIndex % 5 === 0 && 'w-24',
                  columnIndex % 5 === 1 && 'w-32',
                  columnIndex % 5 === 2 && 'w-20',
                  columnIndex % 5 === 3 && 'w-28',
                  columnIndex % 5 === 4 && 'w-16'
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function VehicleDetailsModal({
  row,
  onClose,
}: {
  row: DemoCarRow
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [trackerStatus, setTrackerStatus] = useState(row.trackerStatus || '')
  const [serviceDate, setServiceDate] = useState(row.serviceDate ? String(row.serviceDate).slice(0, 10) : '')
  const [currentReadingKms, setCurrentReadingKms] = useState(row.currentReadingKms ? String(row.currentReadingKms) : '')
  const [onRoadPrice, setOnRoadPrice] = useState(row.onRoadPrice ? String(row.onRoadPrice) : '')
  const [vehicleStatus, setVehicleStatus] = useState(row.vehicleStatus || '')
  const [registrationNumber, setRegistrationNumber] = useState(row.registrationNumber || '')

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/brands/kia/demo-cars-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleKey: row.vehicleKey,
          vin: row.vin,
          trackerStatus,
          serviceDate,
          currentReadingKms,
          onRoadPrice,
          vehicleStatus,
          registrationNumber,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to save vehicle details')
      return payload
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['demo-cars-list'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-[150] bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="isolate mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-300 bg-white text-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[var(--dashboard-action-bg)] px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/70">Vehicle Details</p>
            <h2 className="mt-1 text-2xl font-black">{row.model}</h2>
            <p className="mt-1 text-xs font-bold text-white/75">{row.vin} / {row.location}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl bg-white p-2 text-slate-950 shadow-sm transition hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5" style={{background : "#fff"}}>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Registration Number', row.registrationNumber || '-'],
              ['VIN No', row.vin],
              ['Variant', row.variant],
              ['Color', row.color],
              ['Transporter', row.transporterName || '-'],
              ['Invoice Date', formatDate(row.invoiceDate)],
              ['Amount', formatAmount(row.amount)],
            ].filter(([, value]) => value && value !== '-').map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="mt-1 break-words font-black text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Saved Vehicle Details</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Registration Number</span>
                <input
                  type="text"
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value.toUpperCase())}
                  placeholder="Enter registration number"
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold uppercase outline-none focus:border-[var(--dashboard-action-bg)]"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tracker Status</span>
                <select
                  value={trackerStatus}
                  onChange={(event) => setTrackerStatus(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-action-bg)]"
                >
                  <option value="">Select tracker status</option>
                  <option value="installed">Installed</option>
                  <option value="not_installed">Not Installed</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</span>
                <select
                  value={vehicleStatus}
                  onChange={(event) => setVehicleStatus(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-action-bg)]"
                >
                  <option value="">Select vehicle status</option>
                  <option value="active">Active</option>
                  <option value="sold">Sold</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Service Date</span>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(event) => setServiceDate(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-action-bg)]"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current Reading in KMS</span>
                <input
                  type="number"
                  min="0"
                  value={currentReadingKms}
                  onChange={(event) => setCurrentReadingKms(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-action-bg)]"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">On Road Price</span>
                <input
                  type="number"
                  min="0"
                  value={onRoadPrice}
                  onChange={(event) => setOnRoadPrice(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold outline-none focus:border-[var(--dashboard-action-bg)]"
                />
              </label>
            </div>
            {row.detailsUpdatedAt && (
              <p className="mt-3 text-xs font-bold text-slate-500">
                Last saved by {row.detailsUpdatedBy || 'Unknown'} on {formatDateTime(row.detailsUpdatedAt)}
              </p>
            )}
            {saveMutation.error && (
              <p className="mt-3 text-xs font-bold text-rose-600">{saveMutation.error.message}</p>
            )}
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                className="app-primary-action rounded-2xl"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Details
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DemoCarsListPage() {
  const [location, setLocation] = useState<DemoCarsLocation>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedRow, setSelectedRow] = useState<DemoCarRow | null>(null)

  const queryString = useMemo(() => buildQueryString({
    location,
    search,
    page,
  }), [location, page, search])

  const { data, error, isLoading, isFetching, refetch } = useQuery<DemoCarsPayload>({
    queryKey: ['demo-cars-list', queryString],
    queryFn: async () => {
      const response = await fetch(`/api/brands/kia/demo-cars-list?${queryString}`)
      logApiTimings(response, 'demo-cars-list')
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Demo Cars List')
      return payload
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
    gcTime: DASHBOARD_STALE_TIME_MS,
    placeholderData: (previous) => previous,
  })

  const rows = data?.rows || []
  const pagination = data?.pagination
  const displayColumns = useMemo(
    () => (data?.columns || []).filter((column) => column.key !== 'transporterName'),
    [data?.columns],
  )
  const showTableSkeleton = isFetching && !isLoading

  const handleLocationChange = (nextLocation: DemoCarsLocation) => {
    setLocation(nextLocation)
    setPage(1)
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  return (
    <MainLayout title="Demo Cars List" subtitle="AM Kia test-drive VIN tracker">
      <div className="space-y-6">
        {selectedRow && (
          <VehicleDetailsModal
            row={selectedRow}
            onClose={() => setSelectedRow(null)}
          />
        )}

        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--dashboard-primary-border)] bg-white p-6 shadow-2xl shadow-slate-900/5">
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,var(--dashboard-primary-soft),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--dashboard-action-bg)]">
                <Car className="h-3.5 w-3.5" />
                Demo Stock Control
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">Demo Cars List</h1>
              <p className="mt-2 text-xs font-black uppercase tracking-widest text-slate-500">
                Source last updated: {formatDateTime(data?.meta.sourceUpdatedAt)}
              </p>
            </div>
            <Button type="button" onClick={() => void refetch()} className="app-outline-action rounded-2xl px-4 py-2" disabled={isFetching}>
              <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </section>

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-28 animate-pulse rounded-[2rem] border border-white/60 bg-white/70" />
            <div className="h-96 animate-pulse rounded-[2rem] border border-white/60 bg-white/70" />
          </div>
        ) : error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-xl font-black">Demo Cars List unavailable</h2>
            <p className="mt-2 text-sm font-semibold">{error.message}</p>
          </section>
        ) : (
          <>
            {!data?.meta.detailsTableReady && (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                Vehicle details table is not ready yet. Run <span className="font-black">scripts/create-demo-vehicle-details.sql</span> to enable saving tracker/service/status details.
              </section>
            )}

            {data?.meta.warning && (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                {data.meta.warning}
              </section>
            )}

            <section className="grid gap-3 md:grid-cols-4">
              <SummaryCard label="Total Demo Cars" value={data?.summary.total || 0} helper="test_drive_vin = YES" />
              <SummaryCard label="Jammu" value={data?.summary.jammu || 0} helper="Billing dealer JK402" />
              <SummaryCard label="Udhampur" value={data?.summary.udhampur || 0} helper="Billing dealer JK501" />
              <SummaryCard label="With Saved Details" value={data?.summary.withDetails || 0} helper="Tracker/service data saved" />
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
              <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[1fr_auto]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    placeholder="Search model, variant, color, name, VIN, registration, dealer, status..."
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-semibold outline-none transition focus:border-[var(--dashboard-primary-border)] focus:ring-4 focus:ring-[var(--dashboard-primary-soft)]"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {(['all', 'jammu', 'udhampur'] as DemoCarsLocation[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleLocationChange(item)}
                      className={cn(
                        'h-12 rounded-2xl border px-5 text-xs font-black uppercase tracking-widest shadow-sm transition',
                        location === item
                          ? 'border-[var(--dashboard-action-bg)] bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)]'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-[var(--dashboard-primary-border)] hover:text-[var(--dashboard-action-bg)]'
                      )}
                    >
                      <MapPin className="mr-1.5 inline h-3.5 w-3.5" />
                      {locationLabel(item)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-max min-w-full table-auto border-collapse text-center text-[12px]">
                  <thead className="bg-slate-950 text-white">
                    <tr>
                      {displayColumns.map((column) => (
                        <th key={column.key} className="whitespace-nowrap border border-slate-700 px-4 py-4 text-center text-[9px] font-black uppercase tracking-[0.18em]">
                          {column.label}
                        </th>
                      ))}
                      {['Tracker', 'Service Date', 'Reading', 'On Road Price', 'Status', 'Last Saved'].map((heading) => (
                        <th key={heading} className="whitespace-nowrap border border-slate-700 px-4 py-4 text-center text-[9px] font-black uppercase tracking-[0.18em]">
                          {heading}
                        </th>
                      ))}
                      <th className="sticky right-0 z-20 whitespace-nowrap border border-slate-700 bg-slate-950 px-4 py-4 text-center text-[9px] font-black uppercase tracking-[0.18em] shadow-[-10px_0_18px_rgba(15,23,42,0.2)]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {showTableSkeleton ? (
                      <TableSkeletonRows columnCount={displayColumns.length + 7} />
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={displayColumns.length + 7} className="px-4 py-16 text-center text-sm font-black text-slate-500">
                          No demo cars match the current filter.
                        </td>
                      </tr>
                    ) : rows.map((row) => (
                      <tr key={row.vehicleKey} className="border-b border-slate-200/80 transition hover:bg-[var(--dashboard-primary-soft)]/60">
                        {displayColumns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700',
                              column.key === 'vin' && 'text-[12px] font-black text-[var(--dashboard-action-bg)]',
                              column.key === 'model' && 'font-black text-slate-900'
                            )}
                          >
                            {formatCell(row, column)}
                          </td>
                        ))}
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700">{labelizeStatus(row.trackerStatus)}</td>
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700">{formatDate(row.serviceDate)}</td>
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700">{row.currentReadingKms ? numberFormat(row.currentReadingKms) : '-'}</td>
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700">{formatAmount(row.onRoadPrice)}</td>
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center font-bold text-slate-700">{labelizeStatus(row.vehicleStatus)}</td>
                        <td className="whitespace-nowrap border border-slate-200 px-4 py-4 text-center text-[11px] font-bold text-slate-500">{formatDateTime(row.detailsUpdatedAt)}</td>
                        <td className="sticky right-0 z-10 whitespace-nowrap border border-slate-200 bg-white px-4 py-4 text-center shadow-[-10px_0_18px_rgba(15,23,42,0.08)]">
                          <Button
                            type="button"
                            className="app-primary-action h-10 shrink-0 rounded-2xl px-4"
                            onClick={() => setSelectedRow(row)}
                            disabled={!data?.meta.detailsTableReady}
                          >
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <Clock className="h-4 w-4" />
                  Page {pagination?.page || 1} of {pagination?.totalPages || 1} / {numberFormat(pagination?.totalRows || 0)} vehicles
                </div>
                {(pagination?.totalRows || 0) > 10 && (
                  <div className="flex items-center gap-2">
                    <Button type="button" className="app-outline-action rounded-2xl px-4" disabled={(pagination?.page || 1) <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      Prev
                    </Button>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700">
                      {pagination?.page || 1}
                    </div>
                    <Button type="button" className="app-outline-action rounded-2xl px-4" disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </MainLayout>
  )
}
