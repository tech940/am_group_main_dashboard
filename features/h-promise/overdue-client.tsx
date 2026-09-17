'use client'

import * as React from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  DollarSign,
  Eye,
  Handshake,
  MapPin,
  Search,
  Timer,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatStockNo } from '@/lib/h-promise/constants'
import { normalizeRegNo } from '@/lib/h-promise/registration'
import { useVehicles } from './hp-data'
import { useHpSection, useLabel } from './hp-context'
import { day, inr } from './hp-format'
import { EmptyState, HpButton, RegPlate, StageChip } from './hp-ui'

type UrgencyBucket = 'all' | 'extreme' | 'high' | 'moderate'
type SortField = 'overdue_desc' | 'overdue_asc' | 'price_desc' | 'date_asc'

export function OverdueTab() {
  const { caps, openVehicle } = useHpSection()
  const label = useLabel()
  const list = useVehicles('live', caps.anyView)
  const rows = list.data?.rows ?? []

  const [search, setSearch] = React.useState('')
  const [location, setLocation] = React.useState<string>('all')
  const [urgency, setUrgency] = React.useState<UrgencyBucket>('all')
  const [sort, setSort] = React.useState<SortField>('overdue_desc')

  // Filter vehicles that are overdue
  const allOverdue = React.useMemo(() => {
    return rows.filter((r) => !r.deletedAt && r.flags.saleOverdue)
  }, [rows])

  // KPIs
  const totalOverdueCount = allOverdue.length
  const totalCapitalTied = React.useMemo(() => {
    return allOverdue.reduce((sum, r) => sum + (Number(r.purchasePrice) || 0), 0)
  }, [allOverdue])

  const maxDaysOverdue = React.useMemo(() => {
    return allOverdue.reduce((max, r) => Math.max(max, r.flags.daysOverdue || 0), 0)
  }, [allOverdue])

  const avgDaysOverdue = React.useMemo(() => {
    if (totalOverdueCount === 0) return 0
    const sum = allOverdue.reduce((acc, r) => acc + (r.flags.daysOverdue || 0), 0)
    return Math.round(sum / totalOverdueCount)
  }, [allOverdue, totalOverdueCount])

  // Distinct locations in overdue stock
  const distinctLocations = React.useMemo(() => {
    const set = new Set<string>()
    allOverdue.forEach((r) => {
      if (r.location) set.add(r.location)
    })
    return Array.from(set)
  }, [allOverdue])

  // Filtered & Sorted list
  const filteredOverdue = React.useMemo(() => {
    const q = search.trim().toUpperCase()
    const norm = normalizeRegNo(q)

    return allOverdue
      .filter((r) => {
        // Location filter
        if (location !== 'all' && r.location !== location) return false

        // Urgency filter
        const days = r.flags.daysOverdue || 0
        if (urgency === 'extreme' && days < 30) return false
        if (urgency === 'high' && (days < 15 || days >= 30)) return false
        if (urgency === 'moderate' && days >= 15) return false

        // Search filter
        if (!q) return true
        if (norm && r.regNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase().includes(norm)) return true
        const text = `${r.model} ${r.colour ?? ''} ${formatStockNo(r.stockNo)} ${r.location ?? ''} ${r.buyerName ?? ''}`.toUpperCase()
        return text.includes(q)
      })
      .sort((a, b) => {
        if (sort === 'overdue_desc') return (b.flags.daysOverdue || 0) - (a.flags.daysOverdue || 0)
        if (sort === 'overdue_asc') return (a.flags.daysOverdue || 0) - (b.flags.daysOverdue || 0)
        if (sort === 'price_desc') return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0)
        if (sort === 'date_asc') return (a.purchaseDate || '').localeCompare(b.purchaseDate || '')
        return 0
      })
  }, [allOverdue, search, location, urgency, sort])

  return (
    <div className="space-y-4">
      {/* Alarming Hero Header / Banner */}
      <div className="relative overflow-hidden rounded-xl border border-rose-300 bg-gradient-to-br from-rose-50/90 via-rose-50/40 to-white p-4 sm:p-5 shadow-2xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-sm ring-2 ring-rose-200 animate-pulse">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900">
                  Overdue Target Sale Commitments
                </h2>
                {totalOverdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-2xs animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    {totalOverdueCount} {totalOverdueCount === 1 ? 'vehicle' : 'vehicles'} action required
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-600 max-w-3xl">
                Active vehicles that have breached their committed expected sale dates. Requires immediate sales attention, price correction, or customer re-engagement.
              </p>
            </div>
          </div>
        </div>

        {/* KPI Metrics */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <div className="rounded-lg border border-rose-200/80 bg-white/95 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Overdue Cars</span>
              <AlertCircle className="h-4 w-4 text-rose-600" />
            </div>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-rose-700 tabular-nums">
              {totalOverdueCount}
            </p>
            <p className="text-[11px] text-slate-500">Passed commitment date</p>
          </div>

          <div className="rounded-lg border border-rose-200/80 bg-white/95 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Capital Tied Up</span>
              <DollarSign className="h-4 w-4 text-rose-600" />
            </div>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
              {inr(totalCapitalTied)}
            </p>
            <p className="text-[11px] text-slate-500">Total purchase value</p>
          </div>

          <div className="rounded-lg border border-rose-200/80 bg-white/95 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Max Delay</span>
              <Timer className="h-4 w-4 text-rose-600" />
            </div>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-rose-600 tabular-nums">
              {maxDaysOverdue} <span className="text-xs font-semibold text-slate-500">days</span>
            </p>
            <p className="text-[11px] text-slate-500">Longest overdue car</p>
          </div>

          <div className="rounded-lg border border-rose-200/80 bg-white/95 p-3 shadow-2xs">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Average Delay</span>
              <CalendarClock className="h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-1 text-xl sm:text-2xl font-bold text-slate-800 tabular-nums">
              {avgDaysOverdue} <span className="text-xs font-semibold text-slate-500">days</span>
            </p>
            <p className="text-[11px] text-slate-500">Across overdue inventory</p>
          </div>
        </div>
      </div>

      {totalOverdueCount === 0 ? (
        <EmptyState
          title="All inventory is on schedule"
          icon={<CheckCircle2 className="h-5 w-5 text-slate-700" />}
        >
          No vehicles have exceeded their expected target sale dates. Every car in stock is progressing within committed timelines.
        </EmptyState>
      ) : (
        <>
          {/* Filter and Action Bar */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {/* Search Bar */}
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search overdue cars (plate, model, HP#)..."
                  className="h-8.5 w-full rounded-lg border border-slate-200/80 bg-slate-50/60 pl-8.5 pr-8 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[var(--dashboard-primary)] focus:bg-white focus:outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Urgency Filter */}
              <div className="flex items-center rounded-lg border border-slate-200/80 bg-slate-50/70 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setUrgency('all')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition',
                    urgency === 'all'
                      ? 'bg-white font-semibold text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  All ({allOverdue.length})
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency('extreme')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition',
                    urgency === 'extreme'
                      ? 'bg-rose-100 font-semibold text-rose-800 border border-rose-300/60 shadow-2xs'
                      : 'text-rose-700 hover:text-rose-900',
                  )}
                >
                  &gt; 30d Critical
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency('high')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition',
                    urgency === 'high'
                      ? 'bg-amber-100 font-semibold text-amber-800 border border-amber-300/60 shadow-2xs'
                      : 'text-amber-700 hover:text-amber-900',
                  )}
                >
                  15-30d High
                </button>
                <button
                  type="button"
                  onClick={() => setUrgency('moderate')}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition',
                    urgency === 'moderate'
                      ? 'bg-slate-200 font-semibold text-slate-800 border border-slate-300/60 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  1-14d Moderate
                </button>
              </div>

              {/* Location Selector */}
              {distinctLocations.length > 1 && (
                <div className="relative">
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="h-8.5 appearance-none rounded-lg border border-slate-200/80 bg-slate-50/60 pl-3 pr-8 text-xs font-semibold text-slate-800 focus:border-[var(--dashboard-primary)] focus:bg-white focus:outline-none"
                  >
                    <option value="all">All Locations ({distinctLocations.length})</option>
                    {distinctLocations.map((loc) => (
                      <option key={loc} value={loc}>
                        {label(loc)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                </div>
              )}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortField)}
                className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pl-2.5 pr-7 text-xs font-semibold text-slate-800 focus:border-rose-500 focus:outline-none"
              >
                <option value="overdue_desc">Most Overdue Days First</option>
                <option value="overdue_asc">Least Overdue Days First</option>
                <option value="price_desc">Highest Purchase Value First</option>
                <option value="date_asc">Oldest Purchase Date First</option>
              </select>
            </div>
          </div>

          {/* Overdue Vehicles Table */}
          {filteredOverdue.length === 0 ? (
            <div className="p-8">
              <EmptyState title="No matching overdue vehicles" icon={<Search className="h-5 w-5" />}>
                No vehicles match your current search or filter criteria. Try resetting the filters.
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Vehicle / Stock #</th>
                      <th className="px-4 py-3">Model & Details</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Purchase Date / Cost</th>
                      <th className="px-4 py-3">Target Sale Date</th>
                      <th className="px-4 py-3">Breach Urgency</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                    {filteredOverdue.map((r) => {
                      const days = r.flags.daysOverdue || 0
                      const isExtreme = days >= 30
                      const isHigh = days >= 15 && days < 30

                      return (
                        <tr
                          key={r.id}
                          className="group transition hover:bg-slate-50/60"
                        >
                          {/* Plate & Stock # */}
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col items-start gap-1">
                              <RegPlate regNo={r.regNo} size="sm" />
                              <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                                {formatStockNo(r.stockNo)}
                              </span>
                            </div>
                          </td>

                          {/* Model & Details */}
                          <td className="px-4 py-3 align-middle">
                            <div className="max-w-[220px]">
                              <span className="block truncate font-semibold text-slate-900 group-hover:text-slate-950">
                                {r.model}
                              </span>
                              <span className="block truncate text-[11px] text-slate-500">
                                {r.colour ? `${r.colour} · ` : ''}{r.manufacturingYear ? `${r.manufacturingYear} Model` : 'Pre-owned'}
                              </span>
                            </div>
                          </td>

                          {/* Location */}
                          <td className="px-4 py-3 align-middle">
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-slate-700">
                              <MapPin className="h-3 w-3 text-slate-400" />
                              {label(r.location)}
                            </span>
                          </td>

                          {/* Purchase Date & Cost */}
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900 tabular-nums">
                                {inr(r.purchasePrice)}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Bought {day(r.purchaseDate, false)}
                              </span>
                            </div>
                          </td>

                          {/* Target Sale Date */}
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col">
                              <span className="font-semibold text-rose-700">
                                {day(r.expectedSaleDate ?? '')}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Committed target
                              </span>
                            </div>
                          </td>

                          {/* Breach Urgency Badge */}
                          <td className="px-4 py-3 align-middle">
                            <div className="flex flex-col items-start gap-1">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-2xs',
                                  isExtreme
                                    ? 'bg-rose-600 text-white animate-pulse ring-2 ring-rose-300'
                                    : isHigh
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-rose-100 text-rose-800 border border-rose-300',
                                )}
                              >
                                {isExtreme && '🚨 '}
                                {days} {days === 1 ? 'day' : 'days'} overdue
                              </span>
                              {isExtreme && (
                                <span className="text-[10px] font-medium text-rose-600 uppercase tracking-wide">
                                  Critical Aging
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 align-middle">
                            <StageChip stage={r.stage} />
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3.5 align-middle text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {caps.register.edit && r.stage === 'in_stock' && (
                                <HpButton
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openVehicle(r.id, 'sale')}
                                  title="Record Sale for this overdue vehicle"
                                >
                                  <Handshake />
                                  Sell
                                </HpButton>
                              )}
                              {caps.register.edit && r.stage === 'in_stock' && (
                                <HpButton
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openVehicle(r.id, 'booking')}
                                  title="Book this vehicle"
                                >
                                  <CalendarClock />
                                  Book
                                </HpButton>
                              )}
                              <HpButton
                                size="sm"
                                variant="ghost"
                                onClick={() => openVehicle(r.id, 'overview')}
                                title="Open full vehicle file"
                              >
                                <Eye />
                                View
                              </HpButton>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-slate-500 flex items-center justify-between">
                <span>Showing {filteredOverdue.length} of {allOverdue.length} overdue vehicles</span>
                <span className="font-bold text-rose-700">Total overdue capital tied: {inr(totalCapitalTied)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
