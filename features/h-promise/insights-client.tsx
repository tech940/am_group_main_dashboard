'use client'

import * as React from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Info,
  Lightbulb,
  Printer,
  RotateCcw,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SOLD_TO_LABELS, SOLD_TO_VALUES, formatStockNo } from '@/lib/h-promise/constants'
import { computeInsights, DEFAULT_INSIGHT_FILTERS, type Insight, type InsightFilters, type MixRow } from '@/lib/h-promise/insights-core'
import { AGING_BUCKETS } from '@/lib/h-promise/stage'
import { toast } from '@/hooks/use-toast'
import { downloadHpExport, useSessionValue, useVehicles } from './hp-data'
import { useHpSection, useLabel } from './hp-context'
import { count, day, inr, inrShort, MONTH_NAMES, pct, when } from './hp-format'
import { buildMisHtml, periodTitle, printHtml } from './hp-print'
import {
  AgingBar,
  Band,
  BandCell,
  EmptyState,
  ErrorState,
  FilterSelect,
  HpButton,
  LoadingBlock,
  Money,
  Panel,
  RegPlate,
  Segmented,
  StageChip,
  StatusChip,
  ToneChip,
  type Tone,
} from './hp-ui'

const FILTER_KEY = 'hp-insights-filters'

export function InsightsClient() {
  const { caps, meta } = useHpSection()
  const label = useLabel()
  const query = useVehicles('live')
  const today = query.data?.today ?? meta?.today ?? ''
  const [savedFilters, saveFilters] = useSessionValue(FILTER_KEY)
  const filters = React.useMemo<InsightFilters | null>(() => {
    if (!today) return null
    let saved: Partial<InsightFilters> = {}
    try {
      saved = savedFilters ? (JSON.parse(savedFilters) as Partial<InsightFilters>) : {}
    } catch {
      saved = {}
    }
    return { ...DEFAULT_INSIGHT_FILTERS(today), ...saved }
  }, [savedFilters, today])

  const update = (patch: Partial<InsightFilters>) => {
    saveFilters(JSON.stringify({ ...(filters ?? DEFAULT_INSIGHT_FILTERS(today)), ...patch }))
  }

  const result = React.useMemo(() => {
    if (!query.data || !filters) return null
    return computeInsights(query.data.rows, query.data.bookings, filters, today, label)
  }, [query.data, filters, today, label])

  if (query.isLoading || !filters) return <LoadingBlock label="Working out the MIS" rows={8} />
  if (query.isError && !query.data) return <ErrorState message={query.error instanceof Error ? query.error.message : 'The MIS could not be loaded.'} onRetry={() => query.refetch()} />
  if (!result) return null

  const years = [...new Set([...result.years, Number(today.slice(0, 4))])].sort((a, b) => b - a)
  const staff = (meta?.options.staff ?? []).map((o) => ({ value: o.value, label: o.label }))
  const locations = (meta?.options.location ?? []).map((o) => ({ value: o.value, label: o.label }))
  const exportQuery = new URLSearchParams({
    year: String(filters.year),
    month: String(filters.month),
    location: filters.location,
    soldBy: filters.soldBy,
    soldTo: filters.soldTo,
    booking: filters.booking,
  }).toString()
  const download = (kind: string, title: string) => {
    toast({ title: `Preparing ${title}…` })
    downloadHpExport(`/api/h-promise/export?kind=${kind}&${exportQuery}`).catch((error) =>
      toast({ title: `${title} could not be downloaded`, description: error instanceof Error ? error.message : undefined, variant: 'error' }))
  }
  const print = () => {
    printHtml(buildMisHtml(result, filters, {
      location: filters.location ? label(filters.location) : null,
      printedBy: caps.userName,
      printedAt: when(new Date().toISOString()),
    }))
  }
  const p = result.period
  const s = result.stock
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_INSIGHT_FILTERS(today))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:px-4">
        <FilterSelect label="Year" value={String(filters.year)} onChange={(v) => update({ year: v === 'all' ? 'all' : Number(v) })}
          options={[...years.map((y) => ({ value: String(y), label: String(y) })), { value: 'all', label: 'All years' }]} />
        <FilterSelect label="Month" value={String(filters.month)} onChange={(v) => update({ month: v === 'all' ? 'all' : Number(v) })}
          options={[{ value: 'all', label: 'Every month' }, ...MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))]} />
        <FilterSelect label="Location" value={filters.location} onChange={(v) => update({ location: v })} options={locations} allLabel="All locations" />
        <FilterSelect label="Sold by" value={filters.soldBy} onChange={(v) => update({ soldBy: v })} options={staff} allLabel="Anyone" />
        <FilterSelect label="Sold to" value={filters.soldTo} onChange={(v) => update({ soldTo: v })} options={SOLD_TO_VALUES.map((v) => ({ value: v, label: SOLD_TO_LABELS[v] }))} allLabel="Any buyer" />
        <Segmented label="Booking" value={filters.booking} onChange={(v) => update({ booking: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'booked', label: 'Booked first' }, { value: 'direct', label: 'Direct' }]} />
        {!isDefault && <HpButton size="sm" variant="ghost" onClick={() => update(DEFAULT_INSIGHT_FILTERS(today))}><RotateCcw /> Reset</HpButton>}
        <div className="ml-auto flex items-center gap-2">
          <HpButton size="sm" variant="outline" onClick={print}><Printer /> Print summary</HpButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HpButton size="sm" variant="accent"><Download /> Excel <ChevronDown /></HpButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="hp min-w-[14rem]">
              <DropdownMenuItem onSelect={() => download('monthly', 'the monthly MIS')}>Monthly MIS ({periodTitle(filters)})</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => download('sold', 'the sold list')}>Vehicles sold ({p.soldCount})</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => download('stock', 'active stock')}>Active stock ({s.count})</DropdownMenuItem>
              {caps.register.view && <DropdownMenuItem onSelect={() => download('register', 'the register')}>Whole register</DropdownMenuItem>}
              {caps.register.view && <DropdownMenuItem onSelect={() => download('bonuses', 'exchange bonuses')}>Exchange bonuses</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">{periodTitle(filters)}{filters.location ? ` · ${label(filters.location)}` : ''}</p>
        <Band label="The period">
          <BandCell label="Purchased" tone="stock" value={count(p.purchasedCount)} sub={inrShort(p.purchasedValue)} hint="Counted by purchase date. Rejected purchases are left out." />
          <BandCell label="Sold" tone="sold" value={count(p.soldCount)} sub={`${inrShort(p.saleValue)}${p.soldPendingApproval ? ` · ${p.soldPendingApproval} awaiting approval` : ''}`} hint="Counted by sale date, once a sale is recorded." />
          <BandCell label="Gross profit" tone="accent" value={<Money value={p.grossProfit} />} sub={`With GST ${inrShort(p.grossProfitWithGst)}`} hint="Selling price − (purchase price + other cost). With GST uses the purchase price with GST." />
          <BandCell label="Interest" tone="pending" value={<Money value={p.interest} />} sub="On the cars sold" hint="The yearly rate on the purchase price (without GST), from purchase to sale." />
          <BandCell label="Net profit" tone={p.netProfit < 0 ? 'rejected' : 'approved'} value={<Money value={p.netProfit} signed />} sub={p.netMarginPct === null ? 'No sales' : `${pct(p.netMarginPct)} of sales`} hint="Gross profit with GST − interest." />
          <BandCell label="Days to sell" tone="neutral" value={p.avgDaysToSell === null ? '—' : Math.round(p.avgDaysToSell)} sub={`${p.lossCount} sold at a loss`} hint="Average days from purchase date to sale date." />
        </Band>
      </div>

      <Band cols={5} label="Stock today">
        <BandCell label="Stock today" tone="stock" value={s.count} sub={`${s.bookedCount} booked`} />
        <BandCell label="At cost" tone="accent" value={inrShort(s.valueAtCost)} sub={`With GST ${inrShort(s.valueWithGst)}`} />
        <BandCell label="Interest so far" tone="pending" value={inrShort(s.interestAccrued)} sub="Cost of holding today's stock" />
        <BandCell label="Average age" tone="neutral" value={s.avgAge === null ? '—' : `${Math.round(s.avgAge)} d`} sub={`${s.awaitingPurchaseApproval} purchases not yet approved`} />
        <BandCell label="Over 60 days" tone="rejected" value={s.over60} sub="Oldest stock" />
      </Band>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Bought and sold, month by month">
          <MonthsChart months={result.months} mode="counts" />
        </Panel>
        <Panel title="Sale value and net profit">
          <MonthsChart months={result.months} mode="money" />
        </Panel>
      </div>

      {result.insights.length > 0 && (
        <section aria-labelledby="hp-insights" className="space-y-2">
          <h3 id="hp-insights" className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
            <Lightbulb className="h-4 w-4 text-slate-400" aria-hidden="true" /> What stands out
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Panel title="Sales by location" bodyClassName="p-4"><MixBars rows={result.mix.soldByLocation} labeler={label} tone="sold" money="value" /></Panel>
        <Panel title="Sales by seller" bodyClassName="p-4"><MixBars rows={result.mix.soldBy} labeler={label} tone="accent" money="netProfit" /></Panel>
        <Panel title="Sold to" bodyClassName="p-4"><MixBars rows={result.mix.soldTo} labeler={(v) => SOLD_TO_LABELS[v as keyof typeof SOLD_TO_LABELS] ?? v} tone="booked" money="value" /></Panel>
        <Panel title="Stock by age" bodyClassName="p-4">
          <MixBars
            rows={AGING_BUCKETS.map((bucket) => ({ key: bucket, count: s.buckets[bucket], value: 0, netProfit: 0 }))}
            labeler={(v) => `${v} days`}
            tone="pending"
            keepOrder
          />
        </Panel>
      </div>

      <MonthlyTable result={result} />

      <Compliance result={result} />

      <div className="grid gap-4 2xl:grid-cols-2">
        <StockTable rows={result.stockRows} />
        <SoldTable rows={result.soldRows} />
      </div>
    </div>
  )
}

function MonthsChart({ months, mode }: { months: ReturnType<typeof computeInsights>['months']; mode: 'counts' | 'money' }) {
  if (months.length === 0) return <EmptyState title="No activity in this period" />
  const data = months.map((m) => ({
    label: m.label.replace(/ \d{4}$/, months.length > 12 ? ` ${m.key.slice(2, 4)}` : ''),
    purchased: m.purchasedCount,
    sold: m.soldCount,
    booked: m.bookedCount,
    sale: Math.round(m.saleValue),
    net: Math.round(m.netProfit),
  }))
  const tick = { fontSize: 11, fill: 'var(--hp-muted)' }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 560, height: 256 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: mode === 'money' ? 8 : -16 }}>
          <CartesianGrid vertical={false} stroke="var(--hp-rule)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" />
          {mode === 'counts' ? (
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={tick} width={40} />
          ) : (
            <YAxis tickLine={false} axisLine={false} tick={tick} width={56} tickFormatter={(v: number) => inrShort(v)} />
          )}
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.12)' }}
            contentStyle={{ borderRadius: 8, border: '1px solid var(--hp-rule)', fontSize: 12 }}
            formatter={(value, name) => [mode === 'money' ? inr(Number(value)) : String(value), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
          {mode === 'counts' ? (
            <>
              <Bar isAnimationActive={false} dataKey="purchased" name="Bought" fill="var(--hp-stock)" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar isAnimationActive={false} dataKey="sold" name="Sold" fill="var(--hp-sold)" radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Line isAnimationActive={false} dataKey="booked" name="Booked" stroke="var(--hp-booked)" strokeWidth={2} dot={{ r: 2.5 }} type="monotone" />
            </>
          ) : (
            <>
              <Bar isAnimationActive={false} dataKey="sale" name="Sale value" fill="var(--hp-accent-ink)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line isAnimationActive={false} dataKey="net" name="Net profit" stroke="var(--hp-pending)" strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const INSIGHT_STYLE: Record<Insight['tone'], { tone: Tone; icon: LucideIcon }> = {
  good: { tone: 'approved', icon: TrendingUp },
  watch: { tone: 'pending', icon: Info },
  risk: { tone: 'rejected', icon: AlertTriangle },
  info: { tone: 'accent', icon: CheckCircle2 },
}

function InsightCard({ insight }: { insight: Insight }) {
  const style = INSIGHT_STYLE[insight.tone]
  return (
    <article data-tone={style.tone} className="hp-rise rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="hp-tone inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
          <style.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold leading-snug text-slate-900 [text-wrap:balance]">{insight.title}</p>
          {insight.detail && <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{insight.detail}</p>}
        </div>
      </div>
    </article>
  )
}

function MixBars({ rows, labeler, tone, money, keepOrder }: { rows: MixRow[]; labeler: (value: string) => string; tone: Tone; money?: 'value' | 'netProfit'; keepOrder?: boolean }) {
  const list = keepOrder ? rows : rows.slice(0, 8)
  const max = Math.max(1, ...list.map((row) => row.count))
  const total = list.reduce((sum, row) => sum + row.count, 0)
  if (total === 0) return <p className="py-6 text-center text-sm text-slate-500">Nothing in this period.</p>
  return (
    <ul className="space-y-2.5">
      {list.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="truncate font-medium text-slate-800">{labeler(row.key)}</span>
            <span className="hp-num shrink-0 text-slate-500">
              <strong className="text-slate-900">{row.count}</strong>
              {money && ` · ${inrShort(row[money])}`}
            </span>
          </div>
          <span className="hp-age mt-1 block" data-tone={tone} aria-hidden="true">
            <span style={{ width: `${Math.max(3, (row.count / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function MonthlyTable({ result }: { result: ReturnType<typeof computeInsights> }) {
  const p = result.period
  return (
    <Panel title="Month by month" description="The sheet's MIS, with interest counted to the sale date." bodyClassName="p-0">
      {result.months.length === 0 ? (
        <div className="p-4"><EmptyState title="No activity in this period" /></div>
      ) : (
        <div className="hp-scroll overflow-x-auto overflow-y-visible">
          <table className="hp-table min-w-[980px]">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="text-right">Bought</th>
                <th scope="col" className="text-right">Purchase value</th>
                <th scope="col" className="text-right">Booked</th>
                <th scope="col" className="text-right">Refunded</th>
                <th scope="col" className="text-right">Sold</th>
                <th scope="col" className="text-right">Sale value</th>
                <th scope="col" className="text-right">Gross profit</th>
                <th scope="col" className="text-right">GP with GST</th>
                <th scope="col" className="text-right">Interest</th>
                <th scope="col" className="text-right">Net profit</th>
                <th scope="col" className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {result.months.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className="whitespace-nowrap text-left font-semibold text-slate-900">{m.label}</th>
                  <td className="hp-num text-right">{m.purchasedCount || '—'}</td>
                  <td className="hp-num text-right">{m.purchasedValue ? inr(m.purchasedValue) : '—'}</td>
                  <td className="hp-num text-right">{m.bookedCount || '—'}</td>
                  <td className="hp-num text-right">{m.refundedCount || '—'}</td>
                  <td className="hp-num text-right">{m.soldCount || '—'}</td>
                  <td className="hp-num text-right">{m.saleValue ? inr(m.saleValue) : '—'}</td>
                  <td className="hp-num text-right">{m.soldCount ? <Money value={m.grossProfit} /> : '—'}</td>
                  <td className="hp-num text-right">{m.soldCount ? <Money value={m.grossProfitWithGst} /> : '—'}</td>
                  <td className="hp-num text-right">{m.soldCount ? inr(m.interest) : '—'}</td>
                  <td className="hp-num text-right font-semibold">{m.soldCount ? <Money value={m.netProfit} signed /> : '—'}</td>
                  <td className="hp-num text-right">{m.netMarginPct === null ? '—' : pct(m.netMarginPct)}</td>
                </tr>
              ))}
              <tr className="font-semibold" style={{ background: 'var(--hp-sunken)' }}>
                <th scope="row" className="text-left text-slate-900">Total</th>
                <td className="hp-num text-right">{p.purchasedCount}</td>
                <td className="hp-num text-right">{inr(p.purchasedValue)}</td>
                <td className="hp-num text-right">{p.bookedCount}</td>
                <td className="hp-num text-right">{p.refundedCount}</td>
                <td className="hp-num text-right">{p.soldCount}</td>
                <td className="hp-num text-right">{inr(p.saleValue)}</td>
                <td className="hp-num text-right"><Money value={p.grossProfit} /></td>
                <td className="hp-num text-right"><Money value={p.grossProfitWithGst} /></td>
                <td className="hp-num text-right">{inr(p.interest)}</td>
                <td className="hp-num text-right"><Money value={p.netProfit} signed /></td>
                <td className="hp-num text-right">{p.netMarginPct === null ? '—' : pct(p.netMarginPct)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Compliance({ result }: { result: ReturnType<typeof computeInsights> }) {
  const c = result.compliance
  const overdueCount = result.stockRows.filter((r) => r.flags.saleOverdue).length
  const items: Array<{ label: string; value: number; tone: Tone }> = [
    { label: '🚨 Overdue target sale commitments', value: overdueCount, tone: 'rejected' },
    { label: 'Purchases awaiting approval', value: c.purchasePending, tone: 'pending' },
    { label: 'Sales awaiting approval', value: c.salePending, tone: 'pending' },
    { label: 'Ledgers not uploaded', value: c.ledgerPending, tone: 'pending' },
    { label: 'Sold, documents missing', value: c.docsMissing, tone: 'rejected' },
    { label: 'Broker RC not transferred', value: c.brokerRcPending, tone: 'pending' },
    { label: 'Hypothecation / RTO in progress', value: c.paperworkPending, tone: 'booked' },
    { label: 'Stock with expired insurance', value: c.insuranceExpired, tone: 'rejected' },
    { label: 'Insurance due within 15 days', value: c.insuranceDueSoon, tone: 'pending' },
  ]
  return (
    <Panel title="Open items" description="Across the register today, for the chosen location.">
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.label} data-tone={item.value ? item.tone : 'approved'} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-[12.5px] text-slate-700">{item.label}</span>
            <span className="hp-num hp-tone-text text-lg font-semibold">{item.value}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function StockTable({ rows }: { rows: ReturnType<typeof computeInsights>['stockRows'] }) {
  const { openVehicle } = useHpSection()
  const label = useLabel()
  const [limit, setLimit] = React.useState(15)
  return (
    <Panel title="Stock today" description="Oldest first." bodyClassName="p-0">
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState title="No stock" /></div>
      ) : (
        <div className="hp-scroll overflow-x-auto overflow-y-visible">
          <table className="hp-table min-w-[640px]">
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Location</th>
                <th scope="col">Age</th>
                <th scope="col" className="text-right">Cost</th>
                <th scope="col" className="text-right">Interest</th>
                <th scope="col">Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((row) => (
                <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
                  <td>
                    <div className="flex items-center gap-2">
                      <RegPlate regNo={row.regNo} size="sm" />
                      <span className="max-w-[10rem] truncate font-semibold text-slate-900">{row.model}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{label(row.location)}</td>
                  <td><AgingBar days={row.flags.daysInStock} bucket={row.flags.agingBucket} /></td>
                  <td className="hp-num text-right">{inr(row.purchasePrice)}</td>
                  <td className="hp-num text-right">{inr(row.economics.interest)}</td>
                  <td><StageChip stage={row.stage} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="flex justify-center border-t border-slate-100 p-2.5">
              <HpButton size="sm" variant="outline" onClick={() => setLimit((l) => l + 30)}>Show more ({rows.length - limit})</HpButton>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function SoldTable({ rows }: { rows: ReturnType<typeof computeInsights>['soldRows'] }) {
  const { openVehicle } = useHpSection()
  const label = useLabel()
  const [limit, setLimit] = React.useState(15)
  return (
    <Panel title="Sold in the period" description="Latest first." bodyClassName="p-0">
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState title="No sales in this period" /></div>
      ) : (
        <div className="hp-scroll overflow-x-auto overflow-y-visible">
          <table className="hp-table min-w-[720px]">
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Sold</th>
                <th scope="col">By</th>
                <th scope="col" className="text-right">Price</th>
                <th scope="col" className="text-right">Net profit</th>
                <th scope="col">Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((row) => (
                <tr key={row.id} data-clickable="true" onClick={() => openVehicle(row.id)}>
                  <td>
                    <div className="flex items-center gap-2">
                      <RegPlate regNo={row.regNo} size="sm" />
                      <div className="min-w-0">
                        <p className="max-w-[10rem] truncate font-semibold text-slate-900">{row.model}</p>
                        <p className="hp-mono text-[12px] text-slate-500">{formatStockNo(row.stockNo)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{day(row.saleDate)}<span className="block text-[12.5px] text-slate-500">{row.soldTo ? SOLD_TO_LABELS[row.soldTo as keyof typeof SOLD_TO_LABELS] ?? row.soldTo : ''}</span></td>
                  <td className="whitespace-nowrap">{label(row.soldBy)}</td>
                  <td className="hp-num text-right">{inr(row.sellingPrice)}</td>
                  <td className={cn('hp-num text-right font-semibold')}><Money value={row.economics.netProfit} signed /></td>
                  <td><StatusChip flow="sale" status={row.saleStatus} managerStatus={row.saleManagerStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="flex justify-center border-t border-slate-100 p-2.5">
              <HpButton size="sm" variant="outline" onClick={() => setLimit((l) => l + 30)}>Show more ({rows.length - limit})</HpButton>
            </div>
          )}
        </div>
      )}
      {rows.some((row) => (row.economics.netProfit ?? 0) < 0) && (
        <p className="border-t border-slate-100 px-4 py-2 text-[13px] text-slate-500">
          <ToneChip tone="rejected" className="mr-1.5">Loss</ToneChip>
          A negative net profit means the car sold for less than its cost with GST, other costs and interest.
        </p>
      )}
    </Panel>
  )
}
