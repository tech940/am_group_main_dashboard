'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { FuelManagementResponse, FuelVehicleRow } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { Chip, DataStateTag, EmptyState, NoValue, Panel, Segmented, fmtEff, fmtInr, fmtInrPrecise, fmtKm, fmtQty, type Tone } from './fuel-ui'

type VehicleFilter = 'all' | 'attention' | 'demo' | 'other'

const EFFICIENCY: Record<string, { tone: Tone; word: string }> = {
  good: { tone: 'ok', word: 'On target' },
  watch: { tone: 'review', word: 'Watch' },
  poor: { tone: 'critical', word: 'Below target' },
  no_benchmark: { tone: 'muted', word: 'No target set' },
  no_data: { tone: 'muted', word: 'No data' },
}

function needsLook(v: FuelVehicleRow) {
  return v.attention.length > 0 || v.openExceptions > 0
}

export function VehiclesView({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const [filter, setFilter] = React.useState<VehicleFilter>('all')
  const all = data.vehicles
  const counts = {
    all: all.length,
    attention: all.filter(needsLook).length,
    demo: all.filter((v) => v.isDemo).length,
    other: all.filter((v) => !v.isDemo).length,
  }
  const rows = all.filter((v) =>
    filter === 'attention' ? needsLook(v) : filter === 'demo' ? v.isDemo : filter === 'other' ? !v.isDemo : true,
  )

  return (
    <Panel
      id="fm-vehicles"
      title="Vehicles and other fuel users"
      bodyClassName="p-0"
      action={
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          label="Show vehicles"
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'attention', label: 'Needs a look', count: counts.attention },
            { value: 'demo', label: 'Demo cars', count: counts.demo },
            { value: 'other', label: 'Other', count: counts.other },
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <div className="p-6">
          <EmptyState title={filter === 'attention' ? 'No vehicle needs a look' : 'No vehicles in this view'}>
            {filter === 'attention' ? 'Nothing unusual was found for the vehicles in this period.' : 'Choose a longer period or clear a filter.'}
          </EmptyState>
        </div>
      ) : (
        <div className="fm-scroll overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead className="border-b border-slate-200/80 bg-slate-50/70 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-5 py-3 text-left font-semibold">Vehicle</th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">Fuel</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700">Approved</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Previous period</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700">Billed</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700">Demo km</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700">Mileage</th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">Against target</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-700">Cost / km</th>
                <th scope="col" className="px-5 py-3 text-left font-semibold">Needs attention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[12.5px] sm:text-[13px] font-normal text-slate-700">
              {rows.map((v) => {
                const eff = EFFICIENCY[v.efficiencyStatus] ?? EFFICIENCY.no_data
                return (
                  <tr key={v.key} className="align-top transition-colors duration-100 hover:bg-slate-50/80">
                    <td className="max-w-[18rem] px-5 py-3.5">
                      <button
                        type="button"
                        onClick={() => navigate.openVehicle(v.key)}
                        className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 underline-offset-2 hover:text-slate-950 hover:underline cursor-pointer"
                      >
                        {v.label}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded text-[11px] font-medium border border-slate-200/70">
                          {v.branchLabel}
                        </span>
                        <span className="inline-block bg-slate-50 text-slate-500 px-1.5 py-0.2 rounded text-[11px] font-normal border border-slate-200/60">
                          {v.isDemo ? 'Demo car' : v.kind === 'asset' ? 'Equipment' : v.kind === 'label' ? 'General pool' : 'Fleet car'}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-medium text-slate-700">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[11.5px] font-medium border bg-slate-100 text-slate-700 border-slate-200">
                        {v.energyLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <span className="text-[13px] font-semibold text-slate-900 tabular-nums">{fmtQty(v.approvedQty, v.unit)}</span>
                      <span className="block text-[11px] font-normal text-slate-400">{v.events} record{v.events === 1 ? '' : 's'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right text-slate-500 font-normal tabular-nums">
                      {v.previousQty === null ? <NoValue label="none prior" /> : fmtQty(v.previousQty, v.unit)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">{v.spend ? fmtInr(v.spend) : <NoValue />}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <span className="font-medium text-slate-900 tabular-nums">
                        {v.drives ? fmtKm(v.gateKm) : <NoValue label="no demo drives" />}
                      </span>
                      {v.drives > 0 && <span className="block text-[11px] font-normal text-slate-500">{v.gpsKm ? `GPS ${fmtKm(v.gpsKm)}` : 'no GPS'}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
                      <span className="block text-[13.5px] font-semibold tabular-nums text-slate-900">
                        {v.mileage.average === null ? <NoValue label="no mileage yet" /> : fmtEff(v.mileage.average, v.unit)}
                      </span>
                      {v.kind === 'vin' && (
                        <span className="mt-1 inline-block">
                          <DataStateTag
                            state={v.mileage.average === null ? 'missing' : v.mileage.basis === 'full_tank' ? 'measured' : 'provisional'}
                            title={v.mileage.unavailableReason ?? undefined}
                          />
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      {v.kind === 'vin' ? (
                        <span className="flex flex-col items-start gap-1">
                          <Chip tone={eff.tone}>{eff.word}</Chip>
                          {v.expected !== null && (
                            <span className="text-[11px] font-normal tabular-nums text-slate-500">
                              target {fmtEff(v.expected, v.unit)}{v.efficiencyPct !== null ? ` · ${v.efficiencyPct}%` : ''}
                            </span>
                          )}
                        </span>
                      ) : <NoValue label="not a measured car" />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-medium text-slate-900 tabular-nums">{v.costPerKm === null ? <NoValue /> : fmtInrPrecise(v.costPerKm)}</td>
                    <td className="max-w-[20rem] px-5 py-3.5">
                      {needsLook(v) ? (
                        <div className="rounded-lg bg-amber-50/80 border border-amber-200/80 p-2 shadow-2xs">
                          <span className="block text-[12px] font-medium text-amber-900 leading-snug">
                            {v.attention[0] ?? `${v.openExceptions} open exception${v.openExceptions === 1 ? '' : 's'}`}
                          </span>
                          {(v.attention.length > 1 || (v.attention.length > 0 && v.openExceptions > 0)) && (
                            <span className="block text-[11px] font-normal text-amber-700 mt-0.5">
                              {v.attention.length > 1 ? `+${v.attention.length - 1} more` : ''}
                              {v.attention.length > 0 && v.openExceptions > 0 ? ` · ${v.openExceptions} open exception${v.openExceptions === 1 ? '' : 's'}` : ''}
                            </span>
                          )}
                        </div>
                      ) : v.kind === 'vin' && v.mileage.unavailableReason ? (
                        <span className="block text-[12px] leading-snug text-slate-500 font-normal">{v.mileage.unavailableReason}</span>
                      ) : (
                        <NoValue label="nothing to look at" />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-3 text-[11.5px] leading-relaxed text-slate-500">
        Mileage is measured from full tank to full tank on the car&rsquo;s own odometer. Where no full-tank pair exists yet it is shown as provisional (fill to fill).
        Targets come from the Benchmarks tab.
      </div>
    </Panel>
  )
}
