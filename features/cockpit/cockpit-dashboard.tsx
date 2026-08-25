'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, Wrench, ShoppingCart, Wallet, Car, TrendingUp, TrendingDown, Package, Banknote, Gauge, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type ServiceBrand = { brand: string; brandLabel: string; available: boolean; status: 'ok' | 'no_data' | 'unavailable'; coverageThrough: string | null; lastUploadedAt: string | null; lagging: boolean; revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null }
type CashBrand = { brand: string; brandLabel: string; poAmount: number; poCount: number; fundingAmount: number; spendAmount: number }
type SalesBrand = { brand: string; label: string; available: boolean; monthLabel: string | null; bookings: number; deliveries: number; conversion: number; bookingTarget: number; deliveryTarget: number; bookingAchievement: number | null; deliveryAchievement: number | null; consultants: number; targetBasis?: 'configured' | 'auto' | null }
type StockBrand = { brand: string; label: string; available: boolean; availableStock: number; stockValue: number; avgStockAge: number }
type Cockpit = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; generatedAt: string }
  service: { brands: ServiceBrand[]; totals: { revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null; excluded: string[] } }
  cash: { brands: CashBrand[]; unassignedPresent: boolean; totals: { poAmount: number; poCount: number; fundingAmount: number; spendAmount: number } }
  sales: { brands: SalesBrand[]; totals: { deliveries: number; bookings: number } }
  stock: { brands: StockBrand[]; totals: { availableStock: number; stockValue: number } }
  freshness: { service: string | null; brands: { brand: string; brandLabel: string; lastUploadedAt: string | null; coverageThrough: string | null }[] }
}

function formatCurrency(v: number) {
  const n = Number.isFinite(v) ? v : 0
  const r = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}₹${(r / 10000000).toFixed(2)}Cr`
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(2)}L`
  return `${sign}₹${r.toLocaleString('en-IN')}`
}
function formatInt(v: number) { return Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-IN') }
function formatPct(v: number | null) { return v === null || !Number.isFinite(v) ? '—' : `${v}%` }
function formatAsOf(iso: string | null) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso)) + ' IST'
  } catch { return null }
}
/** "2026-07-14" -> "14 Jul". Parsed as a plain calendar day — no timezone shifting it a day back. */
function formatDay(ymd: string | null) {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return null
  try {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  } catch { return null }
}

async function fetchCockpit(): Promise<Cockpit> {
  const res = await fetch('/api/cockpit', { cache: 'no-store' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load cockpit')
  return res.json()
}

export function CockpitDashboard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Cockpit>({ queryKey: ['cockpit'], queryFn: fetchCockpit })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center" aria-busy="true" aria-live="polite">
        <Loader2 className="h-7 w-7 animate-spin text-slate-500 motion-reduce:animate-none" aria-hidden />
        <span className="sr-only">Loading the group cockpit…</span>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-bold text-rose-700">{(error as Error)?.message || 'Failed to load cockpit.'}</p>
        {/* The global query config sets retry:false, so without this the only way out is a browser
            reload — on the one page an executive opens to check whether anything is wrong. */}
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2"
        >
          {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
          {isFetching ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    )
  }

  const { meta, service, cash, sales, stock, freshness } = data

  return (
    <div className="space-y-6">
      {/* Context ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-[var(--dashboard-action-bg)]" />
          <div>
            <p className="text-sm font-black text-slate-800">{meta.monthLabel} <span className="font-semibold text-slate-500">· month to date (through day {meta.throughDay})</span></p>
            <p className="text-[11px] font-semibold text-slate-500">All figures compared to the same period last year where available.</p>
          </div>
        </div>
        {/* One pill per feed */}
        <div className="flex flex-wrap items-center gap-1.5">
          {freshness.brands.map((f) => {
            const through = f.coverageThrough ? formatDay(f.coverageThrough) : null
            return (
              <div key={f.brand} className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 border border-slate-100" title={f.lastUploadedAt ? `Last upload ${formatAsOf(f.lastUploadedAt)}` : 'Never uploaded'}>
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-[11px] font-bold text-slate-600">
                  {f.brandLabel.replace(/^AM /, '')} {through ? `through ${through}` : 'no data'}
                </span>
                <span className="sr-only">
                  {f.lastUploadedAt ? `Last upload ${formatAsOf(f.lastUploadedAt)}` : 'Never uploaded'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 1. Vehicle sales — ON TOP */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Vehicle Sales Performance · Month to Date</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sales.brands.map((b) => (
            <Card key={`sales-${b.brand}`} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--dashboard-action-bg)]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">{b.label} Sales{b.monthLabel ? ` · ${b.monthLabel}` : ''}</h3>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <MiniStat label="Bookings" value={formatInt(b.bookings)} sub={`target ${formatInt(b.bookingTarget)} · ${formatPct(b.bookingAchievement)}`} />
                <MiniStat label="Deliveries" value={formatInt(b.deliveries)} sub={`target ${formatInt(b.deliveryTarget)} · ${formatPct(b.deliveryAchievement)}`} />
                <MiniStat label="Conversion" value={formatPct(b.conversion)} sub="bookings → deliveries" />
                <MiniStat label="Consultants" value={formatInt(b.consultants)} sub="active this month" />
              </div>
              {b.targetBasis === 'auto' && (
                <p className="mt-3 text-[10px] font-semibold text-slate-400">Targets auto-set: last month + 10% (no target configured for this month)</p>
              )}
            </Card>
          ))}
          {sales.brands.length === 0 && (
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs col-span-full"><p className="text-sm font-semibold text-slate-500">No vehicle sales feed is connected yet.</p></Card>
          )}
        </div>
      </div>

      {/* 2. Vehicle stock — ON TOP */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-[var(--dashboard-action-bg)]" />
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Vehicle Stock &amp; Inventory Health</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stock.brands.map((b) => (
            <Card key={`stock-${b.brand}`} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">{b.label} Stock</h3>
                </div>
              </div>
              {b.available ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <MiniStat label="Available" value={formatInt(b.availableStock)} sub="unsold units" />
                  <MiniStat label="Stock Value" value={formatCurrency(b.stockValue)} sub="approx. invoice" />
                  <MiniStat label="Avg Age" value={`${formatInt(b.avgStockAge)}d`} sub="current stock" />
                </div>
              ) : (
                <p className="text-xs font-semibold italic text-slate-400 py-2">Stock figures could not be read for this brand — not shown as zero.</p>
              )}
            </Card>
          ))}
          {stock.brands.length === 0 && (
            <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs col-span-full"><p className="text-sm font-semibold text-slate-500">No vehicle stock feed is connected yet.</p></Card>
          )}
        </div>
      </div>

      {/* 3. Group KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <BigKpi
          icon={<Wrench className="h-5 w-5" />}
          label="Group Service Revenue"
          value={formatCurrency(service.totals.revenue)}
          sub={service.totals.excluded.length > 0
            ? `${formatInt(service.totals.roCount)} ROs · excludes ${service.totals.excluded.join(', ')}`
            : `${formatInt(service.totals.roCount)} ROs · labour + parts`}
          growth={service.totals.growthPct}
          tone="from-indigo-700 to-indigo-600"
        />
        <BigKpi icon={<ShoppingCart className="h-5 w-5" />} label="Approved Purchase Orders" value={formatCurrency(cash.totals.poAmount)} sub={`${formatInt(cash.totals.poCount)} approved · cumulative`} tone="from-cyan-800 to-cyan-700" />
        <BigKpi icon={<Wallet className="h-5 w-5" />} label="Approved Petty-Cash Spend" value={formatCurrency(cash.totals.spendAmount)} sub={`funding ${formatCurrency(cash.totals.fundingAmount)} · cumulative`} tone="from-teal-800 to-teal-700" />
      </div>

      {/* 4. Service revenue by brand */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-600">Service revenue by brand · MTD vs last year</h2>
          <span className="text-[11px] font-semibold text-slate-500">labour + parts, deduped ROs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Group service revenue by brand, month to date, compared with the same period last year.</caption>
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-50/60">
                <th scope="col" className="px-5 py-2.5 text-left">Brand</th>
                <th scope="col" className="px-5 py-2.5 text-right">Revenue</th>
                <th scope="col" className="px-5 py-2.5 text-right">Labour</th>
                <th scope="col" className="px-5 py-2.5 text-right">Parts</th>
                <th scope="col" className="px-5 py-2.5 text-right">ROs</th>
                <th scope="col" className="px-5 py-2.5 text-right">vs LY</th>
              </tr>
            </thead>
            <tbody>
              {service.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors">
                  <td className="px-5 py-3 text-left font-black text-slate-800">
                    {b.brandLabel}
                    {b.lagging && b.coverageThrough && (
                      <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700" title={`This feed has bills only to ${formatDay(b.coverageThrough)}. Revenue and the vs-LY comparison both cover 1–${formatDay(b.coverageThrough)} of each year.`}>
                        through {formatDay(b.coverageThrough)}
                        <span className="sr-only">
                          {` — this feed has bills only to ${formatDay(b.coverageThrough)}; revenue and the versus-last-year comparison both cover 1 to ${formatDay(b.coverageThrough)} of each year.`}
                        </span>
                      </span>
                    )}
                  </td>
                  {b.status === 'ok' ? (
                    <>
                      <td className="px-5 py-3 text-right font-black text-slate-900 font-sans tabular-nums">{formatCurrency(b.revenue)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.labour)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.parts)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatInt(b.roCount)}</td>
                      <td className="px-5 py-3 text-right"><GrowthBadge pct={b.growthPct} /></td>
                    </>
                  ) : (
                    <td className={`px-5 py-3 text-right text-xs font-semibold italic ${b.status === 'unavailable' ? 'text-rose-700' : 'text-slate-500'}`} colSpan={5}>
                      {b.status === 'unavailable' ? 'Data unavailable — not counted in the group total' : 'No bills this month'}
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                <td className="px-5 py-3 text-left font-black text-slate-900">
                  Group total
                  {service.totals.excluded.length > 0 && (
                    <span className="ml-2 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                      excludes {service.totals.excluded.join(', ')}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-black text-slate-900 font-sans tabular-nums">{formatCurrency(service.totals.revenue)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(service.totals.labour)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(service.totals.parts)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatInt(service.totals.roCount)}</td>
                <td className="px-5 py-3 text-right"><GrowthBadge pct={service.totals.growthPct} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] font-semibold italic text-slate-500">MG and the two-wheeler brands have no service feed and are omitted (not shown as zero).</p>
      </Card>

      {/* 5. Cash oversight by brand */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-600">Approved cash by branch · cumulative</h2>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Banknote className="h-3.5 w-3.5" />approved POs + petty cash</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Approved purchase orders and petty cash by branch, cumulative to date.</caption>
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-50/60">
                <th scope="col" className="px-5 py-2.5 text-left">Branch</th>
                <th scope="col" className="px-5 py-2.5 text-right">Approved POs</th>
                <th scope="col" className="px-5 py-2.5 text-right">PO value</th>
                <th scope="col" className="px-5 py-2.5 text-right">PC funding</th>
                <th scope="col" className="px-5 py-2.5 text-right">PC spend</th>
              </tr>
            </thead>
            <tbody>
              {cash.brands.length === 0 ? (
                <tr><td className="px-5 py-8 text-center text-sm font-semibold text-slate-500" colSpan={5}>No approved cash activity.</td></tr>
              ) : cash.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors">
                  <td className="px-5 py-3 text-left font-black text-slate-800">{b.brandLabel}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatInt(b.poCount)}</td>
                  <td className="px-5 py-3 text-right font-black text-slate-900 font-sans tabular-nums">{formatCurrency(b.poAmount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.spendAmount)}</td>
                </tr>
              ))}
              {cash.brands.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                  <td className="px-5 py-3 text-left font-black text-slate-900">Group total</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatInt(cash.totals.poCount)}</td>
                  <td className="px-5 py-3 text-right font-black text-slate-900 font-sans tabular-nums">{formatCurrency(cash.totals.poAmount)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(cash.totals.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(cash.totals.spendAmount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] font-semibold italic text-slate-500">Cumulative approved to date (POs by MD-approval, petty cash by approval). Group total excludes any unassigned-branch rows. Full detail in the CA section.</p>
      </Card>
    </div>
  )
}

function BigKpi({ icon, label, value, sub, growth, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; growth?: number | null; tone: string }) {
  return (
    <div className={cn('rounded-2xl bg-gradient-to-br p-5 text-white shadow-md', tone)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 opacity-90">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
        {growth !== undefined && growth !== null && (
          <span className={cn('inline-flex items-center gap-0.5 rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-black')}>
            {growth >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{growth >= 0 ? '+' : ''}{growth}%
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] font-semibold opacity-90">{sub}</p>
    </div>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900 font-sans tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{sub}</p>
    </div>
  )
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-xs font-semibold text-slate-500">—</span>
  const up = pct >= 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-black', up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{up ? '+' : ''}{pct}%
    </span>
  )
}
