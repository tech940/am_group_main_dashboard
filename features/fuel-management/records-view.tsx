'use client'

import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FuelLifecycle, FuelQualityKey, FuelTransactionsResponse } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { fetchFuel, filterParams, type FilterState } from './fuel-data'
import { Chip, EmptyState, LifecycleChip, Loading, NoValue, Panel, Segmented, Skeleton, fmtCount, fmtDay, fmtInr, fmtQty } from './fuel-ui'

type StateFilter = FuelLifecycle | 'open_exceptions' | ''
type SortKey = 'date' | 'quantity' | 'cost' | 'variance'

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'in_review', label: 'Awaiting approval' },
  { value: 'to_finalise', label: 'Bill pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'open_exceptions', label: 'With exceptions' },
  { value: 'sent_back', label: 'Sent back' },
  { value: 'rejected', label: 'Rejected' },
]

const QUALITY_WORDS: Record<FuelQualityKey, string> = {
  vehicle_unidentified: 'Car not identified',
  odometer_missing: 'No odometer',
  odometer_unreadable: 'Odometer not a number',
  full_tank_missing: 'Full tank not recorded',
  actual_missing: 'No actual litres',
  cost_missing: 'No bill amount',
  pass_missing: 'No gate pass',
  gps_missing: 'No GPS',
}

/** Declared outside the list so the header cell keeps its identity — and keyboard focus — across a re-sort. */
function SortHeader({
  label,
  value,
  sort,
  direction,
  onSort,
  align = 'right',
}: {
  label: string
  value: SortKey
  sort: SortKey
  direction: 'asc' | 'desc'
  onSort: (value: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sort === value
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-5 py-3.5 font-bold', align === 'right' ? 'text-right' : 'text-left')}
    >
      <button
        type="button"
        onClick={() => onSort(value)}
        className={cn('inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-slate-900', active && 'text-slate-950 font-black')}
      >
        {label}
        {active
          ? (direction === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />)
          : <ArrowUpDown aria-hidden className="size-3.5 text-slate-400" />}
      </button>
    </th>
  )
}

export function RecordsView({
  filters,
  state,
  onStateChange,
  quality,
  onQualityChange,
  navigate,
}: {
  filters: FilterState
  state: StateFilter
  onStateChange: (state: StateFilter) => void
  quality: FuelQualityKey | ''
  onQualityChange: (quality: FuelQualityKey | '') => void
  navigate: FuelNavigate
}) {
  const [search, setSearch] = React.useState('')
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>('date')
  const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc')
  const [page, setPage] = React.useState(1)
  const pageSize = 25

  // Search waits for a pause in typing rather than asking the server on every key.
  React.useEffect(() => {
    const id = window.setTimeout(() => setQ(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])

  const { from, to, branch, brand, purpose, department, energy, fleet, vehicle } = filters
  React.useEffect(() => setPage(1), [from, to, branch, brand, purpose, department, energy, fleet, vehicle, state, quality, q, sort, direction])

  const query = useQuery({
    queryKey: ['fuel-management', 'transactions', from, to, branch, brand, purpose, department, energy, fleet, vehicle, state, quality, q, sort, direction, page],
    queryFn: () => fetchFuel<FuelTransactionsResponse>(
      `/api/fuel-management/transactions?${filterParams(filters, { state, quality, q, sort, direction, page, pageSize })}`,
    ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const sortBy = (key: SortKey) => {
    if (sort === key) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDirection('desc')
    }
  }

  const sortProps = { sort, direction, onSort: sortBy }
  const searchRef = React.useRef<HTMLInputElement | null>(null)

  return (
    <Panel
      id="fm-records"
      title="Fuel records"
      bodyClassName="p-0"
      action={
        data && (
          <span className="text-[12px] tabular-nums text-slate-500" aria-live="polite">
            {fmtCount(data.total)} record{data.total === 1 ? '' : 's'} · {fmtQty(data.totals.approvedQty)} approved · {fmtInr(data.totals.spend)} billed
          </span>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 bg-slate-50/40 p-3.5 sm:p-4">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="fm-record-search" className="sr-only">Search fuel records</label>
          <input
            ref={searchRef}
            id="fm-record-search"
            name="fuel-record-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search request #, registration, VIN…"
            className="h-9 w-72 max-w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 shadow-2xs focus:outline-none focus:ring-2 focus:ring-slate-950/10"
          />
        </div>
        <Segmented size="sm" value={state} onChange={onStateChange} options={STATE_OPTIONS} label="Record state" />
        {quality && (
          <button
            type="button"
            onClick={() => {
              onQualityChange('')
              searchRef.current?.focus()
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:text-slate-900 shadow-2xs cursor-pointer"
          >
            <span>Only: {QUALITY_WORDS[quality]}</span>
            <X aria-hidden className="size-3.5 text-slate-400" />
            <span className="sr-only">Remove this filter</span>
          </button>
        )}
      </div>

      {query.isError ? (
        <div className="p-6">
          <EmptyState title="Fuel records could not be loaded" action={
            <button type="button" onClick={() => query.refetch()} className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer">Try again</button>
          }>
            {query.error instanceof Error ? query.error.message : null}
          </EmptyState>
        </div>
      ) : !data ? (
        <Loading label="Loading fuel records">
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
          </div>
        </Loading>
      ) : data.rows.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No fuel records match">
            {q ? `Nothing matches “${q}”. ` : ''}Try selecting a different status or expanding your date range.
          </EmptyState>
        </div>
      ) : (
        <div aria-busy={query.isFetching || undefined} className={cn('fm-scroll overflow-x-auto transition-opacity duration-150', query.isFetching && 'opacity-60')}>
          <table className="w-full min-w-[1020px] text-left border-collapse">
            <thead className="border-b border-teal-100/80 bg-gradient-to-r from-slate-50/90 via-teal-50/40 to-slate-50/90 text-[11px] font-black uppercase tracking-wider text-slate-600">
              <tr>
                <SortHeader label="Date" value="date" align="left" {...sortProps} />
                <th scope="col" className="px-4 py-3.5 text-left font-black">Request #</th>
                <th scope="col" className="px-4 py-3.5 text-left font-black">Vehicle</th>
                <th scope="col" className="px-4 py-3.5 text-left font-black">Purpose</th>
                <th scope="col" className="px-4 py-3.5 text-right font-black">Requested</th>
                <th scope="col" className="px-4 py-3.5 text-right font-black text-teal-900">Approved</th>
                <SortHeader label="Actual" value="quantity" {...sortProps} />
                <SortHeader label="Variance" value="variance" {...sortProps} />
                <SortHeader label="Bill" value="cost" {...sortProps} />
                <th scope="col" className="px-4 py-3.5 text-left font-black">Status</th>
                <th scope="col" className="px-5 py-3.5 text-left font-black">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-[12.5px] font-medium text-slate-700">
              {data.rows.map((row) => (
                <tr key={row.id} className="transition-colors duration-100 hover:bg-teal-50/30">
                  <td className="whitespace-nowrap px-5 py-4 tabular-nums font-semibold text-slate-600">{fmtDay(row.date)}</td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <button
                      type="button"
                      onClick={() => navigate.openRecord(row.id)}
                      className="font-mono text-xs font-black text-teal-800 underline-offset-2 hover:underline cursor-pointer bg-teal-50/90 px-2.5 py-1 rounded-lg border border-teal-200/90 shadow-2xs transition-all hover:bg-teal-100"
                    >
                      {row.requestNumber}
                    </button>
                  </td>
                  <td className="max-w-[18rem] px-4 py-4">
                    {row.identity === 'label' ? (
                      <span className="block truncate font-bold text-slate-900" title={row.identityNote ?? undefined}>{row.vehicleLabel}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate.openVehicle(row.vehicleKey)}
                        className="block max-w-full truncate text-left font-bold text-slate-900 underline-offset-2 hover:text-teal-900 hover:underline cursor-pointer"
                      >
                        {row.vehicleLabel}
                      </button>
                    )}
                    <span className="inline-block bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded text-[10.5px] font-semibold mt-1 border border-slate-200/70">
                      {row.branchLabel}{row.passNo ? ` · ${row.passNo}` : ''}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <span className="inline-block bg-blue-50 text-blue-800 border border-blue-200/80 px-2 py-0.5 rounded-md font-bold text-[11.5px] shadow-2xs">
                      {row.purposeLabel}
                    </span>
                    {row.department && <span className="block text-[11px] text-slate-500 font-semibold mt-0.5">{row.department}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold text-slate-600 tabular-nums">{fmtQty(row.requested, row.unit)}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-black text-teal-950 tabular-nums">{row.approved === null ? <NoValue label="not approved yet" /> : fmtQty(row.approved, row.unit)}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold text-slate-900 tabular-nums">{row.actual === null ? <NoValue /> : fmtQty(row.actual, row.unit)}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-bold tabular-nums">
                    {row.variance === null || Math.abs(row.variance) < 0.005
                      ? <NoValue label="no difference recorded" />
                      : <span className={cn('px-2 py-0.5 rounded-md text-[11.5px] font-black border shadow-2xs', row.variance > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-blue-50 text-blue-800 border-blue-200')}>
                          {row.variance > 0 ? '+' : '−'}{fmtQty(Math.abs(row.variance), row.unit)}
                        </span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-black text-blue-950 tabular-nums">{row.cost === null ? <NoValue /> : fmtInr(row.cost)}</td>
                  <td className="whitespace-nowrap px-4 py-4"><LifecycleChip lifecycle={row.lifecycle} /></td>
                  <td className="px-5 py-4">
                    <span className="flex flex-wrap gap-1">
                      {row.openExceptions > 0 && <Chip tone="review">{row.openExceptions} exception{row.openExceptions === 1 ? '' : 's'}</Chip>}
                      {row.quality.slice(0, 2).map((key) => <Chip key={key} tone="muted">{QUALITY_WORDS[key]}</Chip>)}
                      {row.quality.length > 2 && (
                        <Chip tone="muted" title={row.quality.slice(2).map((key) => QUALITY_WORDS[key]).join(', ')}>
                          +{row.quality.length - 2}
                          <span className="sr-only">: {row.quality.slice(2).map((key) => QUALITY_WORDS[key]).join(', ')}</span>
                        </Chip>
                      )}
                      {row.openExceptions === 0 && row.quality.length === 0 && <NoValue label="nothing to look at" />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs font-semibold text-slate-500">
          <span className="tabular-nums">
            Showing <span className="font-bold text-slate-800">{fmtCount((data.page - 1) * data.pageSize + 1)}–{fmtCount(Math.min(data.page * data.pageSize, data.total))}</span> of {fmtCount(data.total)}
          </span>
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft aria-hidden className="size-3.5" /> Prev
            </button>
            <span className="px-2 font-mono font-bold text-slate-700 tabular-nums">{data.page} / {pages}</span>
            <button
              type="button"
              disabled={data.page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              Next <ChevronRight aria-hidden className="size-3.5" />
            </button>
          </span>
        </div>
      )}
    </Panel>
  )
}
