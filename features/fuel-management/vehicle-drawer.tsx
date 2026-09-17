'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FuelVehicleProfile } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { fetchFuel, filterParams, type FilterState } from './fuel-data'
import { DrawerSection, FuelDrawer } from './fuel-drawer'
import {
  Chip,
  DataStateTag,
  EmptyState,
  Field,
  LifecycleChip,
  Loading,
  SEVERITY_TONE,
  SeverityIcon,
  Skeleton,
  fmtDay,
  fmtEff,
  fmtInr,
  fmtInrPrecise,
  fmtKm,
  fmtQty,
  fmtWhen,
} from './fuel-ui'
import { TrendChart } from './trend-chart'

const PROBLEM_WORD: Record<string, string> = {
  missing_odometer: 'An odometer reading is missing',
  override_inside: 'An odometer correction sits inside',
  odometer_decrease: 'The odometer went backwards',
  too_short: 'Too short to measure',
}

export function VehicleDrawer({
  target,
  filters,
  canGoBack,
  onBack,
  onClose,
  navigate,
}: {
  target: string | null
  filters: FilterState
  canGoBack: boolean
  onBack: () => void
  onClose: () => void
  navigate: FuelNavigate
}) {
  const { from, to } = filters
  const query = useQuery({
    queryKey: ['fuel-management', 'vehicle', target, from, to],
    queryFn: () => fetchFuel<FuelVehicleProfile>(`/api/fuel-management/vehicles/${encodeURIComponent(target ?? '')}?${filterParams({ ...filters, branch: '', brand: '', purpose: '', department: '', energy: '', fleet: '', vehicle: '' })}`),
    enabled: Boolean(target),
    staleTime: 30_000,
  })
  const profile = query.data
  const v = profile?.vehicle

  return (
    <FuelDrawer
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      onBack={canGoBack ? onBack : undefined}
      backLabel="Back to the previous view"
      title={v?.label ?? 'Vehicle'}
      description={v ? [v.vin ? `VIN ${v.vin}` : null, [v.model, v.variant].filter(Boolean).join(' '), v.branchLabel].filter(Boolean).join(' · ') : undefined}
      headerExtra={v && (
        <>
          {v.isDemo && <Chip tone="info">Demo car</Chip>}
          <Chip tone="info">{v.energyLabel}</Chip>
          {v.openExceptions > 0 && <Chip tone="review">{v.openExceptions} to review</Chip>}
        </>
      )}
    >
      {query.isError ? (
        <EmptyState
          title="This vehicle could not be loaded"
          action={<button type="button" onClick={() => query.refetch()} className="h-8 rounded-lg border border-slate-200 px-3 text-[12.5px] font-medium text-slate-700 hover:text-slate-900">Try again</button>}
        >
          {query.error instanceof Error ? query.error.message : null}
        </EmptyState>
      ) : !profile || !v ? (
        <Loading label="Loading the vehicle">
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </Loading>
      ) : (
        <div>
          <DrawerSection title={`${fmtDay(filters.from)} – ${fmtDay(filters.to, true)}`}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Field label="Approved" hint={v.previousQty !== null ? `${fmtQty(v.previousQty, v.unit)} previous period` : undefined}>
                {fmtQty(v.approvedQty, v.unit)}
              </Field>
              <Field label="Actual">{v.actualQty ? fmtQty(v.actualQty, v.unit) : 'Not recorded'}</Field>
              <Field label="Billed">{v.spend ? fmtInr(v.spend) : '—'}</Field>
              <Field label="Average fill">{v.avgFill === null ? '—' : fmtQty(v.avgFill, v.unit)}</Field>
              <Field label="Demo distance" hint={`${v.drives} drive${v.drives === 1 ? '' : 's'}`}>{fmtKm(v.gateKm)}</Field>
              <Field label="GPS distance">{v.gpsKm ? fmtKm(v.gpsKm) : 'No tracker data'}</Field>
              <Field label="Last fill">{fmtDay(v.lastFill, true)}</Field>
              <Field label="Driven since">{fmtKm(v.kmSinceLastFill)}</Field>
            </dl>
          </DrawerSection>

          <DrawerSection title="Efficiency">
            {v.kind !== 'vin' ? (
              <p className="text-[12.5px] text-slate-500">{v.mileage.unavailableReason}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Field
                    label="Average mileage"
                    hint={<DataStateTag state={v.mileage.average === null ? 'missing' : v.mileage.basis === 'full_tank' ? 'measured' : 'provisional'} />}
                  >
                    {fmtEff(v.mileage.average, v.unit)}
                  </Field>
                  <Field label="Latest stretch">{fmtEff(v.mileage.current, v.unit)}</Field>
                  <Field label="Target" hint={v.efficiencyPct !== null ? `${v.efficiencyPct}% of target` : undefined}>
                    {v.expected === null ? 'Not set' : fmtEff(v.expected, v.unit)}
                  </Field>
                  <Field label="Cost per km">{v.costPerKm === null ? '—' : fmtInrPrecise(v.costPerKm)}</Field>
                </dl>
                {v.mileage.unavailableReason && <p className="mt-3 text-[12.5px] text-slate-500">{v.mileage.unavailableReason}</p>}
                {v.mileage.declining && <p className="mt-2 text-[12.5px] font-medium text-[color:var(--fm-review)]">Mileage has fallen stretch after stretch.</p>}
              </>
            )}
            {v.attention.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg border border-[color:var(--fm-review-line)] bg-[var(--fm-review-bg)] px-3 py-2">
                {v.attention.map((reason) => (
                  <li key={reason} className="text-[12.5px] leading-snug text-[color:var(--fm-review)]">{reason}</li>
                ))}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title="Twelve months">
            {profile.monthly.some((m) => m.qty > 0 || m.gateKm > 0) ? (
              <TrendChart
                data={profile.monthly.map((m) => ({ label: m.label, primary: m.qty, secondary: m.efficiency, extra: m.spend }))}
                primaryLabel="Fuel"
                secondaryLabel="Mileage"
                secondaryUnit={`km/${v.unit}`}
                extraLabel="Billed"
                unit={v.unit}
                height={180}
              />
            ) : (
              <p className="text-[12.5px] text-slate-500">No fuel or drives recorded in the last twelve months.</p>
            )}
          </DrawerSection>

          {profile.segments.length > 0 && (
            <DrawerSection title="Mileage stretches">
              <div className="fm-scroll overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[460px] text-[13px]">
                  <thead className="border-b border-slate-200/80 bg-slate-50/70 text-left text-[12px] font-semibold text-slate-600">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Between</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Measured as</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Distance</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Fuel</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Mileage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[12.5px]">
                    {profile.segments.map((s) => (
                      <tr key={`${s.openedOn}-${s.closedOn}-${s.kind}`} className="transition-colors hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-700">{fmtDay(s.openedOn)} – {fmtDay(s.closedOn)}</td>
                        <td className="px-4 py-3">
                          {s.usable
                            ? <DataStateTag state={s.kind === 'full_tank' ? 'measured' : 'provisional'} />
                            : <span className="text-[12px] text-slate-500">{PROBLEM_WORD[s.problem ?? ''] ?? 'Not usable'}</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-700">{fmtKm(s.distanceKm)}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{fmtQty(s.quantity, v.unit)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{fmtEff(s.efficiency, v.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DrawerSection>
          )}

          <DrawerSection
            title={`Fuel records (${profile.fills.length})`}
            action={profile.fills.length > 20 && (
              <button
                type="button"
                onClick={() => navigate.recordsForVehicle(v.key)}
                className="inline-flex min-h-7 items-center text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline cursor-pointer"
              >
                Showing 20 — see all
              </button>
            )}
          >
            {profile.fills.length === 0 ? (
              <p className="text-[12.5px] text-slate-500">No fuel recorded for this vehicle in the last thirteen months.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {profile.fills.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => navigate.openRecord(f.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/80 cursor-pointer"
                    >
                      <span className="w-18 shrink-0 text-xs font-medium tabular-nums text-slate-500">{fmtDay(f.date)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-slate-800 ring-1 ring-slate-200">{f.requestNumber}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 font-normal">{f.purposeLabel}{f.odometerKm !== null ? ` · ${fmtKm(f.odometerKm)}` : ''}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums">
                        <span className="font-semibold text-slate-900">{fmtQty(f.actual ?? f.approved ?? f.requested, f.unit)}</span>
                        {f.cost !== null && <span className="block font-medium text-slate-600">{fmtInr(f.cost)}</span>}
                      </span>
                      <LifecycleChip lifecycle={f.lifecycle} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>

          {profile.drives.length > 0 && (
            <DrawerSection
              title={`Gate passes (${profile.drives.length})`}
              action={profile.drives.length > 25 ? <span className="text-xs text-slate-500">Latest 25 shown</span> : undefined}
            >
              <div className="fm-scroll overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[480px] text-[13px]">
                  <thead className="border-b border-slate-200/80 bg-slate-50/70 text-left text-[12px] font-semibold text-slate-600">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Pass</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Purpose</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Out</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Odometer</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">GPS</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Pump</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[12.5px]">
                    {profile.drives.slice(0, 25).map((d) => (
                      <tr key={d.passNo} className="transition-colors hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-slate-800 ring-1 ring-slate-200">
                            {d.passNo}
                          </span>
                        </td>
                        <td className="max-w-[10rem] truncate px-4 py-3 font-medium text-slate-700">{d.purpose}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 font-normal">{fmtWhen(d.gateOutAt)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{fmtKm(d.odometerKm)}</td>
                        <td className="px-4 py-3 text-right font-normal tabular-nums text-slate-600">{d.gpsKm === null ? '—' : fmtKm(d.gpsKm)}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{d.pumpLitres === null ? '—' : fmtQty(d.pumpLitres)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DrawerSection>
          )}

          <DrawerSection title="Exceptions">
            {profile.exceptions.length === 0 ? (
              <p className="text-[12.5px] text-slate-500">Nothing unusual recorded for this vehicle.</p>
            ) : (
              <ul className="space-y-2">
                {profile.exceptions.map((x) => (
                  <li key={x.key} className="flex gap-2.5">
                    <SeverityIcon severity={x.severity} className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-slate-900">
                        {x.title} <Chip tone={SEVERITY_TONE[x.severity]}>{x.label}</Chip>
                        <span className="text-[11.5px] font-normal text-slate-500">{fmtDay(x.date)}</span>
                      </p>
                      <p className="text-[12.5px] leading-snug text-slate-600">{x.message}</p>
                      <button
                        type="button"
                        onClick={() => navigate.toTab('exceptions', { exceptionKey: x.key })}
                        className="mt-0.5 inline-flex min-h-7 items-center text-[12px] font-medium text-[color:var(--fm-accent)] hover:underline"
                      >
                        {x.review ? 'See the review' : 'Review it'}
                        <span className="sr-only">: {x.title}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>
        </div>
      )}
    </FuelDrawer>
  )
}
