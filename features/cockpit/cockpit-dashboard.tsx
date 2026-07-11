'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, Wrench, ShoppingCart, Wallet, Car, TrendingUp, TrendingDown, Package, Banknote, Gauge, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type ServiceBrand = { brand: string; brandLabel: string; available: boolean; revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null }
type CashBrand = { brand: string; brandLabel: string; poAmount: number; poCount: number; fundingAmount: number; spendAmount: number }
type SalesBrand = { brand: string; label: string; available: boolean; monthLabel: string | null; bookings: number; deliveries: number; conversion: number; bookingTarget: number; deliveryTarget: number; bookingAchievement: number | null; deliveryAchievement: number | null; consultants: number }
type StockBrand = { brand: string; label: string; available: boolean; availableStock: number; stockValue: number; avgStockAge: number }
type Cockpit = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; generatedAt: string }
  service: { brands: ServiceBrand[]; totals: { revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null } }
  cash: { brands: CashBrand[]; unassignedPresent: boolean; totals: { poAmount: number; poCount: number; fundingAmount: number; spendAmount: number } }
  sales: { brands: SalesBrand[]; totals: { deliveries: number; bookings: number } }
  stock: { brands: StockBrand[]; totals: { availableStock: number; stockValue: number } }
  freshness: { service: string | null }
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

async function fetchCockpit(): Promise<Cockpit> {
  const res = await fetch('/api/cockpit', { cache: 'no-store' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load cockpit')
  return res.json()
}

export function CockpitDashboard() {
  const { data, isLoading, isError, error } = useQuery<Cockpit>({ queryKey: ['cockpit'], queryFn: fetchCockpit })

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
  if (isError || !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">{(error as Error)?.message || 'Failed to load cockpit.'}</div>

  const { meta, service, cash, sales, stock, freshness } = data
  const asOf = formatAsOf(freshness.service)

  return (
    <div className="space-y-6">
      {/* Context ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-indigo-600" />
          <div>
            <p className="text-sm font-black text-slate-800">{meta.monthLabel} <span className="font-semibold text-slate-400">· month to date (through day {meta.throughDay})</span></p>
            <p className="text-[11px] font-semibold text-slate-400">All figures compared to the same period last year where available.</p>
          </div>
        </div>
        {asOf && (
          <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-500">Service data as of {asOf}</span>
          </div>
        )}
      </div>

      {/* Group KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <BigKpi icon={<Wrench className="h-5 w-5" />} label="Group Service Revenue" value={formatCurrency(service.totals.revenue)} sub={`${formatInt(service.totals.roCount)} ROs · labour + parts`} growth={service.totals.growthPct} tone="from-indigo-600 to-indigo-500" />
        <BigKpi icon={<ShoppingCart className="h-5 w-5" />} label="Approved Purchase Orders" value={formatCurrency(cash.totals.poAmount)} sub={`${formatInt(cash.totals.poCount)} approved · cumulative`} tone="from-[#0B5D7A] to-[#0e7490]" />
        <BigKpi icon={<Wallet className="h-5 w-5" />} label="Approved Petty-Cash Spend" value={formatCurrency(cash.totals.spendAmount)} sub={`funding ${formatCurrency(cash.totals.fundingAmount)} · cumulative`} tone="from-[#24766d] to-[#2f8f83]" />
      </div>

      {/* Service revenue by brand */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Service revenue by brand · MTD vs last year</p>
          <span className="text-[11px] font-semibold text-slate-400">labour + parts, deduped ROs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-5 py-2.5 text-left">Brand</th>
                <th className="px-5 py-2.5 text-right">Revenue</th>
                <th className="px-5 py-2.5 text-right">Labour</th>
                <th className="px-5 py-2.5 text-right">Parts</th>
                <th className="px-5 py-2.5 text-right">ROs</th>
                <th className="px-5 py-2.5 text-right">vs LY</th>
              </tr>
            </thead>
            <tbody>
              {service.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 text-left font-black text-slate-800">{b.brandLabel}</td>
                  {b.available ? (
                    <>
                      <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(b.revenue)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.labour)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.parts)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatInt(b.roCount)}</td>
                      <td className="px-5 py-3 text-right"><GrowthBadge pct={b.growthPct} /></td>
                    </>
                  ) : (
                    <td className="px-5 py-3 text-right text-xs font-semibold italic text-slate-400" colSpan={5}>No service data</td>
                  )}
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-5 py-3 text-left font-black text-slate-900">Group total</td>
                <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(service.totals.revenue)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700">{formatCurrency(service.totals.labour)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700">{formatCurrency(service.totals.parts)}</td>
                <td className="px-5 py-3 text-right font-bold text-slate-700">{formatInt(service.totals.roCount)}</td>
                <td className="px-5 py-3 text-right"><GrowthBadge pct={service.totals.growthPct} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] font-semibold italic text-slate-400">MG and the two-wheeler brands have no service feed and are omitted (not shown as zero).</p>
      </Card>

      {/* Cash oversight by brand */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Approved cash by branch · cumulative</p>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Banknote className="h-3.5 w-3.5" />approved POs + petty cash</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-5 py-2.5 text-left">Branch</th>
                <th className="px-5 py-2.5 text-right">Approved POs</th>
                <th className="px-5 py-2.5 text-right">PO value</th>
                <th className="px-5 py-2.5 text-right">PC funding</th>
                <th className="px-5 py-2.5 text-right">PC spend</th>
              </tr>
            </thead>
            <tbody>
              {cash.brands.length === 0 ? (
                <tr><td className="px-5 py-8 text-center text-sm font-semibold text-slate-400" colSpan={5}>No approved cash activity.</td></tr>
              ) : cash.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 text-left font-black text-slate-800">{b.brandLabel}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatInt(b.poCount)}</td>
                  <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(b.poAmount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600">{formatCurrency(b.spendAmount)}</td>
                </tr>
              ))}
              {cash.brands.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-5 py-3 text-left font-black text-slate-900">Group total</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">{formatInt(cash.totals.poCount)}</td>
                  <td className="px-5 py-3 text-right font-black text-slate-900">{formatCurrency(cash.totals.poAmount)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">{formatCurrency(cash.totals.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700">{formatCurrency(cash.totals.spendAmount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] font-semibold italic text-slate-400">Cumulative approved to date (POs by MD-approval, petty cash by approval). Group total excludes any unassigned-branch rows. Full detail in the CA section.</p>
      </Card>

      {/* Vehicle sales — one card per brand with a live feed (KIA only today) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sales.brands.map((b) => (
          <Card key={`sales-${b.brand}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><Car className="h-4 w-4 text-indigo-600" /><p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{b.label} Sales{b.monthLabel ? ` · ${b.monthLabel}` : ''}</p></div>
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Bookings" value={formatInt(b.bookings)} sub={`target ${formatInt(b.bookingTarget)} · ${formatPct(b.bookingAchievement)}`} />
              <MiniStat label="Deliveries" value={formatInt(b.deliveries)} sub={`target ${formatInt(b.deliveryTarget)} · ${formatPct(b.deliveryAchievement)}`} />
              <MiniStat label="Conversion" value={formatPct(b.conversion)} sub="bookings → deliveries" />
              <MiniStat label="Consultants" value={formatInt(b.consultants)} sub="active this month" />
            </div>
          </Card>
        ))}
        {sales.brands.length === 0 && (
          <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2"><p className="text-sm font-semibold text-slate-400">No vehicle sales feed is connected yet.</p></Card>
        )}
      </div>
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
      <p className="mt-1 text-[11px] font-semibold opacity-80">{sub}</p>
    </div>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{sub}</p>
    </div>
  )
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-xs font-semibold text-slate-400">—</span>
  const up = pct >= 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-black', up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{up ? '+' : ''}{pct}%
    </span>
  )
}
