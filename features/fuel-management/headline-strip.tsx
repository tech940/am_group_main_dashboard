'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Car,
  Clock,
  Coins,
  Fuel,
  Gauge,
  IndianRupee,
  Navigation,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FuelManagementResponse } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { Change, DataStateTag, fmtCount, fmtEff, fmtInr, fmtInrPrecise, fmtKm, fmtQty, type DataState } from './fuel-ui'

type Cell = {
  key: string
  label: string
  value: string
  unitHint?: string
  sub: React.ReactNode
  state?: DataState
  icon: React.ComponentType<{ className?: string }>
  cardTheme: {
    bg: string
    border: string
    hoverBorder: string
    iconBg: string
    iconColor: string
    valueColor: string
    labelColor: string
  }
  onOpen: () => void
  actionLabel: string
}

export function HeadlineStrip({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const h = data.headline
  const fleet = h.fleet
  const mileageState: DataState = !fleet || fleet.efficiency === null ? 'missing' : fleet.basis === 'full_tank' ? 'measured' : 'provisional'
  const costState: DataState | undefined = !fleet || fleet.costPerKm === null
    ? 'missing'
    : fleet.costedSegments < fleet.segments ? 'partial' : undefined

  const cells: Cell[] = [
    {
      key: 'spend',
      label: 'Fuel spend',
      value: fmtInr(h.spend.current),
      icon: IndianRupee,
      cardTheme: {
        bg: 'bg-gradient-to-br from-blue-50/80 via-white to-white',
        border: 'border-blue-200/80',
        hoverBorder: 'hover:border-blue-400 hover:shadow-blue-500/5',
        iconBg: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200/70',
        iconColor: 'text-blue-700',
        valueColor: 'text-blue-950',
        labelColor: 'text-blue-900',
      },
      sub: h.spend.costedEvents === 0
        ? 'No bills recorded yet'
        : <Change current={h.spend.current} previous={h.spend.previous} />,
      state: h.spend.costedEvents > 0 && h.spend.costedEvents < h.approvedEvents.current ? 'partial' : undefined,
      onOpen: () => navigate.toTab('records', { recordState: 'completed' }),
      actionLabel: 'Show billed fuel records',
    },
    {
      key: 'approved',
      label: 'Fuel approved',
      value: fmtQty(h.approvedQty.current, 'L'),
      icon: Fuel,
      cardTheme: {
        bg: 'bg-gradient-to-br from-teal-50/80 via-white to-white',
        border: 'border-teal-200/80',
        hoverBorder: 'hover:border-teal-400 hover:shadow-teal-500/5',
        iconBg: 'bg-teal-100 text-teal-700 ring-1 ring-teal-200/70',
        iconColor: 'text-teal-700',
        valueColor: 'text-teal-950',
        labelColor: 'text-teal-900',
      },
      sub: h.actualQty.recordedEvents
        ? `${fmtQty(h.reconciled.actualQty)} filled on ${h.actualQty.recordedEvents} of ${h.actualQty.eligibleEvents} (${h.reconciled.variance >= 0 ? '+' : '−'}${fmtQty(Math.abs(h.reconciled.variance))})`
        : `actual not recorded on any of ${fmtCount(h.actualQty.eligibleEvents)}`,
      state: h.actualQty.eligibleEvents === 0 ? undefined : h.actualQty.recordedEvents === 0 ? 'missing' : h.actualQty.recordedEvents < h.actualQty.eligibleEvents ? 'partial' : 'measured',
      onOpen: () => navigate.toTab('records', { recordState: '' }),
      actionLabel: 'Show fuel records',
    },
    {
      key: 'distance',
      label: 'Demo distance',
      value: fmtKm(h.distance.gateKm),
      icon: Navigation,
      cardTheme: {
        bg: 'bg-gradient-to-br from-sky-50/80 via-white to-white',
        border: 'border-sky-200/80',
        hoverBorder: 'hover:border-sky-400 hover:shadow-sky-500/5',
        iconBg: 'bg-sky-100 text-sky-700 ring-1 ring-sky-200/70',
        iconColor: 'text-sky-700',
        valueColor: 'text-sky-950',
        labelColor: 'text-sky-900',
      },
      sub: h.distance.drives
        ? `${fmtCount(h.distance.drives)} drives · GPS on ${fmtCount(h.distance.gpsDrives)}`
        : 'No returned demo drives',
      onOpen: () => navigate.toTab('vehicles'),
      actionLabel: 'Show vehicles',
    },
    {
      key: 'mileage',
      label: 'Average mileage',
      value: fleet?.efficiency != null ? fmtEff(fleet.efficiency, 'L') : '—',
      icon: Gauge,
      cardTheme: {
        bg: 'bg-gradient-to-br from-emerald-50/80 via-white to-white',
        border: 'border-emerald-200/80',
        hoverBorder: 'hover:border-emerald-400 hover:shadow-emerald-500/5',
        iconBg: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/70',
        iconColor: 'text-emerald-700',
        valueColor: 'text-emerald-950',
        labelColor: 'text-emerald-900',
      },
      sub: fleet?.efficiency != null
        ? `${fmtQty(fleet.quantity)} over ${fmtKm(fleet.distanceKm)}`
        : 'Needs two fills with odometer readings',
      state: mileageState,
      onOpen: () => navigate.toTab('vehicles'),
      actionLabel: 'Show vehicle mileage',
    },
    {
      key: 'cost-km',
      label: 'Cost per km',
      value: fleet?.costPerKm != null ? fmtInrPrecise(fleet.costPerKm) : '—',
      icon: Coins,
      cardTheme: {
        bg: 'bg-gradient-to-br from-violet-50/80 via-white to-white',
        border: 'border-violet-200/80',
        hoverBorder: 'hover:border-violet-400 hover:shadow-violet-500/5',
        iconBg: 'bg-violet-100 text-violet-700 ring-1 ring-violet-200/70',
        iconColor: 'text-violet-700',
        valueColor: 'text-violet-950',
        labelColor: 'text-violet-900',
      },
      sub: fleet && fleet.segments > 0
        ? `billed on ${fmtCount(fleet.costedSegments)} of ${fmtCount(fleet.segments)} stretches`
        : 'Needs billed fills on the same car',
      state: costState,
      onOpen: () => navigate.toTab('vehicles'),
      actionLabel: 'Show vehicle costs',
    },
    {
      key: 'pending',
      label: 'Waiting',
      value: fmtCount(h.pending.review + h.pending.toClose),
      icon: Clock,
      cardTheme: {
        bg: 'bg-gradient-to-br from-amber-50/90 via-white to-white',
        border: 'border-amber-200/90',
        hoverBorder: 'hover:border-amber-400 hover:shadow-amber-500/5',
        iconBg: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300/70',
        iconColor: 'text-amber-700',
        valueColor: 'text-amber-800',
        labelColor: 'text-amber-900',
      },
      sub: `${fmtCount(h.pending.review)} to approve · ${fmtCount(h.pending.toClose)} to close`
        + (h.pending.overdueToClose ? ` · ${fmtCount(h.pending.overdueToClose)} overdue` : ''),
      onOpen: () => navigate.toTab('records', { recordState: h.pending.review > 0 ? 'in_review' : 'to_finalise' }),
      actionLabel: 'Show requests waiting',
    },
    {
      key: 'exceptions',
      label: 'Open exceptions',
      value: fmtCount(h.exceptions.open),
      icon: AlertTriangle,
      cardTheme: {
        bg: 'bg-gradient-to-br from-rose-50/90 via-white to-white',
        border: 'border-rose-200/90',
        hoverBorder: 'hover:border-rose-400 hover:shadow-rose-500/5',
        iconBg: 'bg-rose-100 text-rose-800 ring-1 ring-rose-300/70',
        iconColor: 'text-rose-700',
        valueColor: 'text-rose-800',
        labelColor: 'text-rose-900',
      },
      sub: h.exceptions.open
        ? `${fmtCount(h.exceptions.critical)} critical · ${fmtCount(h.exceptions.review)} to review`
        : h.exceptions.reviewed ? `${fmtCount(h.exceptions.reviewed)} reviewed` : 'Nothing unusual found',
      onOpen: () => navigate.toTab('exceptions'),
      actionLabel: 'Show exceptions',
    },
    {
      key: 'vehicles',
      label: 'Vehicles to check',
      value: fmtCount(h.vehiclesNeedingAttention),
      icon: Car,
      cardTheme: {
        bg: 'bg-gradient-to-br from-orange-50/90 via-white to-white',
        border: 'border-orange-200/90',
        hoverBorder: 'hover:border-orange-400 hover:shadow-orange-500/5',
        iconBg: 'bg-orange-100 text-orange-800 ring-1 ring-orange-300/70',
        iconColor: 'text-orange-700',
        valueColor: 'text-orange-800',
        labelColor: 'text-orange-900',
      },
      sub: h.vehiclesFuelled ? `${fmtCount(h.vehiclesFuelled)} identified cars fuelled` : 'No identified car fuelled',
      onOpen: () => navigate.toTab('vehicles'),
      actionLabel: 'Show vehicles needing a look',
    },
  ]

  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
        {cells.map((cell) => {
          const IconComponent = cell.icon
          const theme = cell.cardTheme
          return (
            <li key={cell.key} className="min-w-0">
              <button
                type="button"
                onClick={cell.onOpen}
                className={cn(
                  'fm-inset-focus group flex h-full w-full flex-col justify-between items-start gap-2.5 p-4 text-left transition-all duration-200 rounded-2xl border shadow-2xs active:scale-[0.99] cursor-pointer',
                  theme.bg,
                  theme.border,
                  theme.hoverBorder,
                )}
              >
                <div className="flex w-full items-center justify-between gap-1.5 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className={cn('flex size-7 items-center justify-center rounded-lg shadow-2xs', theme.iconBg)}>
                      <IconComponent className="size-3.5" />
                    </div>
                    <span className={cn('text-[11px] sm:text-[11.5px] font-black uppercase tracking-wider', theme.labelColor)}>
                      {cell.label}
                    </span>
                  </div>
                  {cell.state && <DataStateTag state={cell.state} />}
                </div>

                <div className="my-0.5">
                  <span
                    className={cn(
                      'text-2xl sm:text-[26px] font-black leading-none tracking-tight font-mono tabular-nums',
                      theme.valueColor,
                      cell.value === '—' && 'text-slate-300',
                    )}
                  >
                    {cell.value}
                    {cell.value === '—' && <span className="sr-only">not available</span>}
                  </span>
                </div>

                <div className="text-[11px] sm:text-[11.5px] font-medium leading-snug text-slate-600 transition-colors border-t border-slate-200/50 pt-2 w-full">
                  {cell.sub}
                </div>
                <span className="sr-only">. {cell.actionLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {h.otherUnits.length > 0 && (
        <p className="px-3 py-1 text-xs font-semibold text-slate-500">
          Not in litre figures: {h.otherUnits.map((u) => `${fmtQty(u.approvedQty, u.unit)} approved`).join(' · ')}.
        </p>
      )}
    </div>
  )
}
