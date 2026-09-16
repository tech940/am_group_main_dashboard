'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import type { FuelTransactionDetail } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { fetchFuel, filterParams, type FilterState } from './fuel-data'
import { DrawerSection, FuelDrawer } from './fuel-drawer'
import {
  Chip,
  DataStateTag,
  EmptyState,
  Field,
  FuelTrace,
  LifecycleChip,
  Loading,
  SEVERITY_TONE,
  SeverityIcon,
  Skeleton,
  fmtDay,
  fmtDuration,
  fmtEff,
  fmtInr,
  fmtInrPrecise,
  fmtKm,
  fmtQty,
  fmtWhen,
} from './fuel-ui'

const ENERGY_WORD: Record<string, string> = { petrol: 'Petrol', diesel: 'Diesel', cng: 'CNG', ev: 'Electric', hybrid: 'Hybrid', other: 'Not recorded' }
const PASS_STATUS: Record<string, string> = { out: 'Out of the gate', returned: 'Returned', approved: 'Approved, not yet out', cancelled: 'Cancelled', expired: 'Expired', rejected: 'Rejected', pending_approval: 'Waiting for approval' }
const TRIP_STATUS: Record<string, string> = { untracked: 'No tracker linked', unavailable: 'Tracker subscription expired', failed: 'GPS could not be read', reconciled: 'Checked' }

export function RecordDrawer({
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
    queryKey: ['fuel-management', 'transaction', target, from, to],
    queryFn: () => fetchFuel<FuelTransactionDetail>(`/api/fuel-management/transactions/${target}?${filterParams({ ...filters, branch: '', brand: '', purpose: '', department: '', energy: '', fleet: '', vehicle: '' })}`),
    enabled: Boolean(target),
    staleTime: 30_000,
  })
  const detail = query.data
  const e = detail?.event

  return (
    <FuelDrawer
      open={Boolean(target)}
      onOpenChange={(open) => !open && onClose()}
      onBack={canGoBack ? onBack : undefined}
      backLabel="Back to the previous view"
      title={e ? <span className="font-mono text-[16px]">{e.requestNumber}</span> : 'Fuel record'}
      description={e ? `${e.vehicleLabel} · ${fmtDay(e.date, true)} · ${e.branchLabel}` : undefined}
      headerExtra={e && (
        <>
          <LifecycleChip lifecycle={e.lifecycle} />
          <Chip tone="info">{e.purposeLabel}</Chip>
          {e.department && <Chip tone="info">{e.department}</Chip>}
          {e.openExceptions > 0 && <Chip tone="review">{e.openExceptions} to review</Chip>}
        </>
      )}
      footer={e && (
        <>
          {e.identity !== 'label' && (
            <button
              type="button"
              onClick={() => navigate.openVehicle(e.vehicleKey)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:text-slate-900"
            >
              Open vehicle
            </button>
          )}
          <Link
            href="/fuel-approvals"
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--fm-accent)] px-3 text-[12.5px] font-semibold text-white hover:brightness-110"
          >
            Open in Fuel Approvals <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        </>
      )}
    >
      {query.isError ? (
        <EmptyState
          title="This record could not be loaded"
          action={<button type="button" onClick={() => query.refetch()} className="h-8 rounded-lg border border-slate-200 px-3 text-[12.5px] font-medium text-slate-700 hover:text-slate-900">Try again</button>}
        >
          {query.error instanceof Error ? query.error.message : null}
        </EmptyState>
      ) : !detail || !e ? (
        <Loading label="Loading the fuel record">
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </Loading>
      ) : (
        <div>
          <DrawerSection title="From request to road">
            <FuelTrace steps={detail.steps} compact />
          </DrawerSection>

          <DrawerSection title="Fuel">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label="Requested">{fmtQty(e.requested, e.unit)}</Field>
              <Field label="Approved">{e.approved === null ? '—' : fmtQty(e.approved, e.unit)}</Field>
              <Field label="Actual" hint={e.variance !== null && Math.abs(e.variance) >= 0.005 ? `${e.variance > 0 ? '+' : '−'}${fmtQty(Math.abs(e.variance), e.unit)} vs approved` : undefined}>
                {e.actual === null ? 'Not recorded' : fmtQty(e.actual, e.unit)}
              </Field>
              <Field label="Bill">{e.cost === null ? 'Not recorded' : fmtInr(e.cost)}</Field>
              <Field label="Per unit">{e.unitPrice === null ? '—' : `${fmtInrPrecise(e.unitPrice)}/${e.unit}`}</Field>
              <Field label="Fuel">{ENERGY_WORD[e.energy]}</Field>
              <Field label="Odometer at fill">{e.odometerKm === null ? 'Not recorded' : fmtKm(e.odometerKm)}</Field>
              <Field label="Full tank">{e.fullTank === null ? 'Not recorded' : e.fullTank ? 'Yes' : 'No, partial'}</Field>
              <Field label="Station">{e.station ?? '—'}</Field>
            </dl>
          </DrawerSection>

          <DrawerSection title="People">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label="Requested by" hint={fmtWhen(e.createdAt)}>{e.requesterName}</Field>
              <Field label="Approved by" hint={e.approvedAt ? fmtWhen(e.approvedAt) : undefined}>{e.approverName ?? '—'}</Field>
              <Field label="Bill recorded by" hint={e.closedAt ? fmtWhen(e.closedAt) : undefined}>{e.closedByName ?? '—'}</Field>
            </dl>
          </DrawerSection>

          {detail.pass && (
            <DrawerSection title={`Gate pass ${detail.pass.passNo}`}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Field label="Status">{PASS_STATUS[detail.pass.status] ?? detail.pass.status}</Field>
                <Field label="Out">{fmtWhen(detail.pass.gateOutAt)}</Field>
                <Field label="In">{fmtWhen(detail.pass.gateInAt)}</Field>
                <Field label="Odometer out / in">
                  {fmtKm(detail.pass.gateOutOdo)} / {fmtKm(detail.pass.gateInOdo)}
                </Field>
                <Field label="Driven">{fmtKm(detail.pass.odometerKm)}</Field>
                <Field label="Pump meter">{fmtQty(detail.pass.pumpLitres)}{detail.pass.pumpAmount !== null ? ` · ${fmtInr(detail.pass.pumpAmount)}` : ''}</Field>
                <Field label="Driver">{detail.pass.driverKind === 'customer' ? 'Customer' : detail.pass.staffDriverName ?? 'Staff'}</Field>
                <Field label="Raised by">{detail.pass.raisedByName}</Field>
                {detail.pass.gps && (
                  <Field
                    label="GPS"
                    hint={detail.pass.gps.discrepancy ? 'Disagrees with the odometer' : detail.pass.gps.status === 'reconciled' ? `${fmtDuration(detail.pass.gps.movingSeconds)} moving` : TRIP_STATUS[detail.pass.gps.status] ?? detail.pass.gps.status}
                  >
                    {detail.pass.gps.gpsKm === null ? 'No tracker data' : fmtKm(detail.pass.gps.gpsKm)}
                  </Field>
                )}
              </dl>
            </DrawerSection>
          )}

          {e.identity === 'vin' && (
            <DrawerSection title="Since the previous fill">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Field label="Previous fill">{fmtDay(detail.analysis.previousFillDate, true)}</Field>
                <Field label="Odometer distance">{fmtKm(detail.analysis.distanceSincePreviousKm)}</Field>
                <Field label="Demo drives">{detail.drivesSincePrevious.length}</Field>
                <Field
                  label="Mileage"
                  hint={detail.analysis.efficiencyBasis ? <DataStateTag state={detail.analysis.efficiencyBasis === 'full_tank' ? 'measured' : 'provisional'} /> : undefined}
                >
                  {fmtEff(detail.analysis.efficiency, e.unit)}
                </Field>
                <Field label="Expected fuel" hint={detail.analysis.expectedEfficiency !== null ? `at ${fmtEff(detail.analysis.expectedEfficiency, e.unit)}` : undefined}>
                  {detail.analysis.expectedQty === null ? '—' : fmtQty(detail.analysis.expectedQty, e.unit)}
                </Field>
                <Field label="Cost per km">{detail.analysis.costPerKm === null ? '—' : fmtInrPrecise(detail.analysis.costPerKm)}</Field>
              </dl>
              {detail.drivesSincePrevious.length > 0 && (
                <table className="mt-3 w-full text-[12.5px]">
                  <thead className="text-left text-[11.5px] text-slate-500">
                    <tr>
                      <th scope="col" className="py-1.5 font-medium">Drive</th>
                      <th scope="col" className="py-1.5 font-medium">Out</th>
                      <th scope="col" className="py-1.5 text-right font-medium">Odometer</th>
                      <th scope="col" className="py-1.5 text-right font-medium">GPS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.drivesSincePrevious.map((d) => (
                      <tr key={d.passNo}>
                        <td className="py-1.5 font-mono text-[12px] text-slate-700">{d.passNo}</td>
                        <td className="py-1.5 text-slate-600">{fmtWhen(d.gateOutAt)}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-900">{fmtKm(d.odometerKm)}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-600">{d.gpsKm === null ? 'no data' : fmtKm(d.gpsKm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {detail.analysis.notes.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {detail.analysis.notes.map((note) => (
                    <li key={note} className="text-[12px] leading-snug text-slate-500">{note}</li>
                  ))}
                </ul>
              )}
            </DrawerSection>
          )}
          {e.identity === 'label' && e.identityNote && (
            <DrawerSection title="Vehicle">
              <p className="text-[12.5px] leading-relaxed text-slate-600">{e.identityNote}</p>
            </DrawerSection>
          )}

          <DrawerSection title="Exceptions">
            {detail.exceptions.length === 0 ? (
              <p className="text-[12.5px] text-slate-500">Nothing unusual on this record.</p>
            ) : (
              <ul className="space-y-2">
                {detail.exceptions.map((x) => (
                  <li key={x.key} className="flex gap-2.5">
                    <SeverityIcon severity={x.severity} className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-slate-900">
                        {x.title} <Chip tone={SEVERITY_TONE[x.severity]}>{x.label}</Chip>
                        {x.review && <Chip tone="ok">Reviewed</Chip>}
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

          <DrawerSection title="History">
            {detail.timeline.length === 0 && <p className="text-[12.5px] text-slate-500">No history was recorded for this request.</p>}
            <ol className="space-y-2">
              {detail.timeline.map((t, i) => (
                <li key={`${t.at}-${i}`} className="flex gap-3 text-[12.5px]">
                  <time dateTime={t.at} className="w-28 shrink-0 tabular-nums text-slate-500">{fmtWhen(t.at)}</time>
                  <span className="text-slate-800">
                    <span className="font-medium">{t.action}</span> by {t.actorName}
                    {t.actorRole && <span className="text-slate-500"> · {t.actorRole.replace(/_/g, ' ')}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </DrawerSection>
        </div>
      )}
    </FuelDrawer>
  )
}
