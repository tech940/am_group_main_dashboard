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
  iconTheme?: { bg: string; text: string }
  onOpen: () => void
  actionLabel: string
}

export function HeadlineStrip({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const h = data.headline
  const fleet = h.fleet
  const mileageState: DataState = !fleet || fleet.efficiency === null ? 'missing' : fleet.basis === 'full_tank' ? 'measured' : 'provisional'

  /*
   * Estimates (owner, 2026-09-19): a fill with no bill is priced at the market rate in Fuel settings. They are
   * added to the figure but always named beside it, so a billed rupee and an estimated one never look alike.
   */
  const spend = h.spend
  const spendTotal = spend.current + spend.estimated
  const unbilledLeft = h.approvedEvents.current - spend.costedEvents - spend.estimatedEvents
  const spendState: DataState | undefined = spend.estimatedEvents > 0
    ? (unbilledLeft > 0 ? 'partial' : 'estimated')
    : spend.costedEvents > 0 && spend.costedEvents < h.approvedEvents.current ? 'partial' : undefined
  const priceNote = `petrol ${fmtInrPrecise(spend.prices.petrol)}/L, diesel ${fmtInrPrecise(spend.prices.diesel)}/L`

  const allBilled = !!fleet && fleet.segments > 0 && fleet.costedSegments === fleet.segments
  const costPerKm = !fleet ? null : allBilled ? fleet.costPerKm : fleet.costPerKmWithEstimates ?? fleet.costPerKm
  const costState: DataState | undefined = !fleet || costPerKm === null
    ? 'missing'
    : allBilled ? undefined : fleet.estimatedSegments > 0 ? 'estimated' : 'partial'

  const cells: Cell[] = [
    {
      key: 'spend',
      label: 'Fuel spend',
      value: fmtInr(spendTotal),
      icon: IndianRupee,
      sub: spend.estimatedEvents > 0
        ? `${fmtInr(spend.current)} billed · ${fmtInr(spend.estimated)} estimated on ${fmtCount(spend.estimatedEvents)} unbilled fill${spend.estimatedEvents === 1 ? '' : 's'}`
        : spend.costedEvents === 0
          ? 'No bills recorded yet'
          : <Change current={spend.current} previous={spend.previous} />,
      state: spendState,
      onOpen: () => navigate.toTab('records', { recordState: 'completed' }),
      actionLabel: 'Show billed fuel records',
    },
    {
      key: 'approved',
      label: 'Fuel approved',
      value: fmtQty(h.approvedQty.current, 'L'),
      icon: Fuel,
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
      sub: fleet?.efficiency != null
        ? `${fmtQty(fleet.quantity)} over ${fmtKm(fleet.distanceKm)}${fleet.implausibleSegments ? ` · ${fmtCount(fleet.implausibleSegments)} mistyped stretch${fleet.implausibleSegments === 1 ? '' : 'es'} left out` : ''}`
        : fleet?.implausibleSegments
          ? `${fmtCount(fleet.implausibleSegments)} stretch${fleet.implausibleSegments === 1 ? '' : 'es'} left out — odometer looks mistyped`
          : 'Needs two fills with odometer readings',
      state: mileageState,
      onOpen: () => navigate.toTab('vehicles'),
      actionLabel: 'Show vehicle mileage',
    },
    {
      key: 'cost-km',
      label: 'Cost per km',
      value: costPerKm != null ? fmtInrPrecise(costPerKm) : '—',
      icon: Coins,
      sub: fleet && fleet.segments > 0
        ? allBilled || fleet.estimatedSegments === 0
          ? `billed on ${fmtCount(fleet.costedSegments)} of ${fmtCount(fleet.segments)} stretches`
          : `billed on ${fmtCount(fleet.costedSegments)} of ${fmtCount(fleet.segments)} stretches · rest at ${priceNote}`
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
      iconTheme: { bg: 'bg-amber-50', text: 'text-amber-700' },
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
      iconTheme: { bg: 'bg-rose-50', text: 'text-rose-700' },
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
      iconTheme: { bg: 'bg-orange-50', text: 'text-orange-700' },
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
          const iconTheme = cell.iconTheme ?? { bg: 'bg-slate-100', text: 'text-slate-700' }
          return (
            <li key={cell.key} className="min-w-0">
              <button
                type="button"
                onClick={cell.onOpen}
                className="fm-inset-focus group flex h-full w-full flex-col justify-between items-start gap-2.5 p-4 text-left transition-all duration-150 rounded-2xl border border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs active:scale-[0.99] cursor-pointer"
              >
                <div className="flex w-full items-center justify-between gap-1.5 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className={cn('flex size-7 items-center justify-center rounded-lg', iconTheme.bg, iconTheme.text)}>
                      <IconComponent className="size-3.5" />
                    </div>
                    <span className="text-[12px] font-medium text-slate-600">
                      {cell.label}
                    </span>
                  </div>
                  {cell.state && <DataStateTag state={cell.state} />}
                </div>

                <div className="my-0.5">
                  <span
                    className={cn(
                      'text-2xl sm:text-[25px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums',
                      cell.value === '—' && 'text-slate-300',
                    )}
                  >
                    {cell.value}
                    {cell.value === '—' && <span className="sr-only">not available</span>}
                  </span>
                </div>

                <div className="text-[11.5px] font-normal leading-snug text-slate-500 border-t border-slate-100 pt-2 w-full">
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
