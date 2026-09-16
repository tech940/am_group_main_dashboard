import * as React from 'react'
import {
  Activity,
  AlertCircle,
  ChevronRight,
  Gauge,
  Layers,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FuelAttentionItem, FuelBreakdownRow, FuelManagementResponse, FuelTraceStep } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import {
  Bar,
  DataStateTag,
  EmptyState,
  FuelTrace,
  LifecycleChip,
  NoValue,
  Panel,
  Segmented,
  SeverityIcon,
  fmtEff,
  fmtInr,
  fmtKm,
  fmtQty,
  fmtWhen,
} from './fuel-ui'
import { TrendChart } from './trend-chart'

type BreakdownKey = keyof FuelManagementResponse['breakdowns']

const BREAKDOWN_OPTIONS: { value: BreakdownKey; label: string }[] = [
  { value: 'purpose', label: 'Purpose' },
  { value: 'branch', label: 'Branch' },
  { value: 'department', label: 'Department' },
  { value: 'brand', label: 'Brand' },
  { value: 'energy', label: 'Fuel type' },
]

const ACTIVITY_VERB: Record<FuelManagementResponse['activity'][number]['kind'], string> = {
  raised: 'Requested',
  approved: 'Approved',
  closed: 'Bill recorded',
  sent_back: 'Sent back',
  rejected: 'Rejected',
}

function signed(value: number, unit = 'L'): string {
  if (Math.abs(value) < 0.005) return 'no change'
  return `${value > 0 ? '+' : '−'}${fmtQty(Math.abs(value), unit)}`
}

export function OverviewView({ data, navigate }: { data: FuelManagementResponse; navigate: FuelNavigate }) {
  const h = data.headline
  const [breakdownKey, setBreakdownKey] = React.useState<BreakdownKey>('purpose')

  const open = (item: FuelAttentionItem) => {
    const t = item.target
    if (t.kind === 'event') navigate.openRecord(t.id)
    else if (t.kind === 'vehicle') navigate.openVehicle(t.key)
    else if (t.kind === 'exception') navigate.toTab('exceptions', { exceptionKey: t.key })
    else navigate.toTab(t.tab === 'transactions' ? 'records' : t.tab, { recordState: (t.state as never) ?? '' })
  }

  // The period's fuel, followed through its chain.
  const trace: Pick<FuelTraceStep, 'key' | 'label' | 'state' | 'value' | 'detail' | 'actor' | 'at'>[] = [
    { key: 'requested', label: 'Requested', state: 'done', value: fmtQty(h.requestedQty), detail: `${h.approvedEvents.current + h.pending.review} requests`, actor: null, at: null },
    {
      key: 'approved',
      label: 'Approved',
      state: h.approvedEvents.current ? 'done' : 'pending',
      value: fmtQty(h.approvedQty.current),
      detail: h.pending.review ? `${h.pending.review} still waiting` : 'All decided',
      actor: null,
      at: null,
    },
    {
      key: 'filled',
      label: 'Actually filled',
      state: h.actualQty.recordedEvents === 0 ? 'missing' : h.reconciled.variance > 0.01 ? 'mismatch' : h.actualQty.recordedEvents < h.actualQty.eligibleEvents ? 'pending' : 'done',
      value: h.actualQty.recordedEvents ? fmtQty(h.reconciled.actualQty) : null,
      detail: `recorded on ${h.actualQty.recordedEvents} of ${h.actualQty.eligibleEvents}`,
      actor: null,
      at: null,
    },
    {
      key: 'closed',
      label: 'Billed',
      state: h.spend.costedEvents === 0 ? 'missing' : h.spend.costedEvents < h.approvedEvents.current ? 'pending' : 'done',
      value: h.spend.costedEvents ? fmtInr(h.spend.current) : null,
      detail: `bill on ${h.spend.costedEvents} of ${h.approvedEvents.current}`,
      actor: null,
      at: null,
    },
    {
      key: 'driven',
      label: 'Demo driven',
      state: h.distance.drives ? 'done' : 'not_applicable',
      value: h.distance.drives ? fmtKm(h.distance.gateKm) : null,
      detail: `${h.distance.drives} returned drives`,
      actor: null,
      at: null,
    },
    {
      key: 'verified',
      label: 'GPS checked',
      state: !h.distance.drives ? 'not_applicable' : h.distance.gpsDrives ? 'done' : 'missing',
      value: h.distance.gpsDrives ? fmtKm(h.distance.gpsKm) : null,
      detail: h.distance.drives ? `tracker data on ${h.distance.gpsDrives} of ${h.distance.drives}` : null,
      actor: null,
      at: null,
    },
  ]
  const links = [
    signed(h.approvedQty.current - h.requestedQty),
    h.reconciled.events ? signed(h.reconciled.variance) : null,
    null,
    null,
    null,
  ]

  const breakdown = data.breakdowns[breakdownKey]
  const maxQty = Math.max(1, ...breakdown.map((row) => row.approvedQty))
  const trendData = data.trend.points.map((p) => ({ label: p.label, primary: p.approvedQty, secondary: p.actualQty || null, extra: p.spend }))
  const vehicles = data.vehicles.filter((v) => v.kind === 'vin').slice(0, 8)

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {/* What needs attention */}
      <Panel
        id="fm-attention"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 shadow-2xs">
              <AlertCircle className="size-4" />
            </div>
            <span>What needs attention</span>
          </div>
        }
        className="xl:col-span-2"
        bodyClassName="p-0"
        action={
          data.attention.length ? (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-[11.5px] font-bold text-rose-700 ring-1 ring-rose-200/60 ring-inset shadow-2xs">
              {data.attention.length} item{data.attention.length === 1 ? '' : 's'}
            </span>
          ) : null
        }
      >
        {data.attention.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing needs attention for this period">
              Every request is decided, every approved order has its bill, and no exception is open.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.attention.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="group flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors duration-150 hover:bg-slate-50/90"
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-50/80 ring-1 ring-rose-200/60 shadow-2xs">
                    <SeverityIcon severity={item.severity} className="size-4" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold text-slate-900 group-hover:text-rose-950">{item.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-500">{item.detail}</span>
                  </span>
                  <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-slate-400 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-slate-600 motion-reduce:transition-none" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="fm-summary"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-teal-100 text-teal-700 shadow-2xs">
              <Sparkles className="size-4" />
            </div>
            <span>In short</span>
          </div>
        }
      >
        {data.narrative.length ? (
          <ul className="space-y-3">
            {data.narrative.map((sentence) => (
              <li key={sentence} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-600 ring-4 ring-teal-50" />
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">No fuel records in this period.</p>
        )}
        <div className="mt-5 border-t border-slate-100 pt-3.5 text-[11.5px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-700">
            {data.settingsSource === 'defaults' ? 'Standard thresholds' : 'Custom team thresholds'}
          </span>
          {' · '}
          {data.benchmarksConfigured ? `${data.benchmarksConfigured} mileage benchmark${data.benchmarksConfigured === 1 ? '' : 's'}` : 'no mileage benchmarks yet'}
          {data.sync.loconavLastRunAt ? ` · GPS synced ${fmtWhen(data.sync.loconavLastRunAt)}` : ''}
        </div>
      </Panel>

      <Panel id="fm-trace" title="Where the period's fuel stands" className="xl:col-span-3">
        <FuelTrace steps={trace} links={links} />
      </Panel>

      <Panel
        id="fm-trend"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 shadow-2xs">
              <TrendingUp className="size-4" />
            </div>
            <span>Fuel over time</span>
          </div>
        }
        className="xl:col-span-2"
        action={<span className="text-[12px] font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">Grouped by {data.trend.granularity}</span>}
      >
        {data.trend.points.some((p) => p.events > 0) ? (
          <TrendChart data={trendData} primaryLabel="Approved litres" secondaryLabel="Actual litres" extraLabel="Billed" />
        ) : (
          <EmptyState title="No fuel in this period">Choose a longer period, or clear a filter.</EmptyState>
        )}
      </Panel>

      <Panel
        id="fm-activity"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 shadow-2xs">
              <Activity className="size-4" />
            </div>
            <span>Recent activity</span>
          </div>
        }
        bodyClassName="p-0"
      >
        {data.activity.length === 0 ? (
          <div className="p-6"><EmptyState title="No activity in this period" /></div>
        ) : (
          <ol className="divide-y divide-slate-100">
            {data.activity.map((item) => (
              <li key={`${item.eventId}-${item.at}`}>
                <button
                  type="button"
                  onClick={() => navigate.openRecord(item.eventId)}
                  className="group flex w-full flex-col gap-1 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-slate-50/80"
                >
                  <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-500">
                    <time dateTime={item.at} className="font-semibold text-slate-600">{fmtWhen(item.at)}</time>
                    <LifecycleChip lifecycle={item.lifecycle} />
                  </div>
                  <span className="truncate text-[13.5px] font-bold text-slate-900 group-hover:text-teal-900">{item.vehicleLabel}</span>
                  <div className="text-[12px] tabular-nums text-slate-500">
                    <span className="font-semibold text-slate-700">{ACTIVITY_VERB[item.kind]}</span>
                    {item.qty !== null ? ` · ${fmtQty(item.qty, item.unit)}` : ''}
                    {item.cost !== null ? ` · ${fmtInr(item.cost)}` : ''}
                    {' · '}
                    <span>{item.branchLabel}</span>
                    {item.openExceptions > 0 && <span className="font-bold text-amber-700"> · {item.openExceptions} to review</span>}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        id="fm-where"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 shadow-2xs">
              <Layers className="size-4" />
            </div>
            <span>Where the fuel goes</span>
          </div>
        }
        className="xl:col-span-2"
        bodyClassName="p-0"
        action={<Segmented size="sm" value={breakdownKey} onChange={setBreakdownKey} options={BREAKDOWN_OPTIONS} label="Group fuel by" />}
      >
        <BreakdownTable rows={breakdown} maxQty={maxQty} label={BREAKDOWN_OPTIONS.find((o) => o.value === breakdownKey)?.label ?? ''} />
      </Panel>

      <Panel
        id="fm-efficiency"
        title={
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 shadow-2xs">
              <Gauge className="size-4" />
            </div>
            <span>Demo car efficiency</span>
          </div>
        }
        bodyClassName="p-0"
        action={
          <button type="button" onClick={() => navigate.toTab('vehicles')} className="inline-flex min-h-7 items-center px-1 text-[12px] font-bold text-teal-700 hover:text-teal-800 hover:underline">
            All vehicles →
          </button>
        }
      >
        {vehicles.length === 0 ? (
          <div className="p-6"><EmptyState title="No identified cars in this view" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {vehicles.map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  onClick={() => navigate.openVehicle(v.key)}
                  className="group flex w-full items-center gap-3.5 px-5 py-3 text-left transition-colors duration-150 hover:bg-slate-50/80"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-teal-900">{v.label}</span>
                    <span className="block text-[12px] tabular-nums text-slate-500">
                      {fmtQty(v.approvedQty)} · {fmtKm(v.gateKm)}
                    </span>
                    {v.mileage.average === null && v.mileage.unavailableReason && (
                      <span className="block text-[11.5px] leading-snug text-slate-500">{v.mileage.unavailableReason}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-[13.5px] font-bold tabular-nums text-slate-900">
                      {v.mileage.average === null ? <NoValue label="no mileage yet" /> : fmtEff(v.mileage.average, v.unit)}
                    </span>
                    <DataStateTag
                      state={v.mileage.average === null ? 'missing' : v.mileage.basis === 'full_tank' ? 'measured' : 'provisional'}
                      title={v.mileage.unavailableReason ?? undefined}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

export function BreakdownTable({ rows, maxQty, label }: { rows: FuelBreakdownRow[]; maxQty: number; label: string }) {
  if (rows.length === 0) return <div className="p-6"><EmptyState title="No fuel to group for this view" /></div>
  return (
    <div className="fm-scroll overflow-x-auto">
      <table className="w-full min-w-[580px] text-[13px]">
        <thead>
          <tr className="border-b border-teal-100/80 bg-gradient-to-r from-slate-50/90 via-teal-50/50 to-slate-50/90 text-left text-[11px] font-black uppercase tracking-wider text-slate-600">
            <th scope="col" className="px-5 py-3.5 font-black">{label}</th>
            <th scope="col" className="w-[34%] px-4 py-3.5 font-black">Share of approved</th>
            <th scope="col" className="px-4 py-3.5 text-right font-black text-teal-900">Approved</th>
            <th scope="col" className="px-4 py-3.5 text-right font-black">Actual</th>
            <th scope="col" className="px-4 py-3.5 text-right font-black text-blue-900">Billed</th>
            <th scope="col" className="px-5 py-3.5 text-right font-black">Records</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.key} className="transition-colors hover:bg-teal-50/30">
              <td className="px-5 py-4 text-left">
                <div className="flex items-center gap-2.5">
                  <span className="size-2 rounded-full bg-teal-500 ring-4 ring-teal-50 shrink-0" />
                  <span className="block max-w-[14rem] truncate font-bold text-slate-900" title={row.label}>{row.label}</span>
                </div>
              </td>
              <td className="px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <Bar pct={(row.approvedQty / maxQty) * 100} decorative />
                  <span className="w-13 shrink-0 text-right font-mono text-[11.5px] font-black tabular-nums text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/80">{row.sharePct}%</span>
                </div>
              </td>
              <td className="px-4 py-4 text-right font-mono font-black tabular-nums text-teal-950">{fmtQty(row.approvedQty)}</td>
              <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums text-slate-800">{row.actualQty ? fmtQty(row.actualQty) : <NoValue />}</td>
              <td className="px-4 py-4 text-right font-mono font-black tabular-nums text-blue-950">{row.spend ? fmtInr(row.spend) : <NoValue />}</td>
              <td className="px-5 py-4 text-right font-mono font-bold tabular-nums">
                <span className="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[11.5px] border border-slate-200/70">
                  {row.events}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
