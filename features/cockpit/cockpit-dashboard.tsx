'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Loader2, Wrench, ShoppingCart, Wallet, Car, TrendingUp, TrendingDown, Package, Banknote, Gauge, Clock, Receipt } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { indiaToday, useIndiaSnapshot } from './india-snapshot-section'

type ServiceBrand = { brand: string; brandLabel: string; available: boolean; status: 'ok' | 'no_data' | 'unavailable'; coverageThrough: string | null; lastUploadedAt: string | null; lagging: boolean; revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null }
type CashBrand = { brand: string; brandLabel: string; vendorPaymentAmount: number; vendorPaymentCount: number; poAmount: number; poCount: number; fundingAmount: number; spendAmount: number }
type SalesBrand = { brand: string; label: string; available: boolean; monthLabel: string | null; bookings: number; deliveries: number; conversion: number; bookingTarget: number; deliveryTarget: number; bookingAchievement: number | null; deliveryAchievement: number | null; consultants: number; targetBasis?: 'configured' | 'auto' | null }
type StockBrand = { brand: string; label: string; available: boolean; availableStock: number; stockValue: number; avgStockAge: number; aged61To90?: number; agedOver90?: number }
type MdQueue = {
  total: number
  sources: { id: string; label: string; href: string; count: number; amount: number; withoutAmount: number; oldestDays: number | null }[]
  byBranch: { branchLabel: string; count: number }[]
}
type BankFacilities = {
  total: number
  expired: { count: number; creditLimit: number }
  expiringSoon: { count: number; creditLimit: number; withinDays: number }
  items: { loanType: string; location: string; expiryDate: string; creditLimit: number | null; expired: boolean }[]
}
type DmsExceptions = {
  month: string; open: number; review: number
  byType: { type: string; label: string; severity: 'critical' | 'high' | 'medium'; count: number }[]
  unmatchedDms: number
  lastRunAt: string | null; stale: boolean
}
type Cockpit = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; generatedAt: string }
  service: { brands: ServiceBrand[]; totals: { revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null; excluded: string[] } }
  cash: { brands: CashBrand[]; unassignedPresent: boolean; available?: boolean; totals: { vendorPaymentAmount: number; vendorPaymentCount: number; poAmount: number; poCount: number; fundingAmount: number; spendAmount: number } }
  sales: { brands: SalesBrand[]; totals: { deliveries: number; bookings: number } }
  stock: { brands: StockBrand[]; totals: { availableStock: number; stockValue: number } }
  /** Present only for the MD / Developer; the API strips them for everyone else. */
  mdQueue?: MdQueue | null
  bankFacilities?: BankFacilities | null
  dmsExceptions?: DmsExceptions | null
  freshness: { service: string | null; brands: { brand: string; brandLabel: string; lastUploadedAt: string | null; coverageThrough: string | null }[] }
  degraded?: string[]
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
  /*
   * ⚠️ retry is set EXPLICITLY here because the global query config sets `retry: false`, and this is
   * the one endpoint in the app that legitimately takes seconds: a cold build fans out to every
   * brand's canonical aggregation. Under the global setting a single blip — a cold start, a dropped
   * connection, a gateway hiccup — pinned the section on "Failed to load cockpit" until the user
   * noticed the retry button. That is the "sometimes it does not load at all" report.
   *
   * Two retries with backoff, and NOT on a 401/403: an auth or permission failure is a real answer,
   * and retrying it just delays telling the user.
   */
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Cockpit>({
    queryKey: ['cockpit'],
    queryFn: fetchCockpit,
    retry: (failureCount, err) => {
      if (/\b(401|403|Unauthorized|Forbidden)\b/i.test((err as Error)?.message || '')) return false
      return failureCount < 2
    },
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6000),
    // A payload with a section missing is cached for one minute only (cockpit-data.ts), so ask again
    // just after that instead of leaving the gap on screen until someone reloads.
    refetchInterval: (query) => ((query.state.data?.degraded?.length ?? 0) > 0 ? 65_000 : false),
  })

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
  const degraded = data.degraded ?? []
  const cashOk = cash.available !== false

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

      {degraded.length > 0 && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
          Not read this time: {degraded.join(', ')}. Those parts are marked below and left out of every total, never shown as zero. The page asks again in about a minute.
        </p>
      )}

      {/* Needs attention — the API sends only the blocks this viewer may see */}
      {(data.mdQueue || data.bankFacilities || data.dmsExceptions) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {data.mdQueue && <MdQueuePanel queue={data.mdQueue} countedAt={meta.generatedAt} />}
          {data.bankFacilities && <BankFacilitiesPanel facilities={data.bankFacilities} />}
          {data.dmsExceptions && <DmsExceptionsPanel dms={data.dmsExceptions} />}
        </div>
      )}

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
              {/*
                * ⚠️ A FAILED READ IS NOT ZERO SALES.
                *
                * The Stock card below has always had this guard; the Sales card did not, and that is
                * a live defect, not future-proofing. When the KIA sales reader exceeds its 25s
                * deadline (cockpit-data.ts BUDGET.secondary — measured at 12-20s cold, so within a
                * few seconds of tripping), withDeadline returns null and a placeholder carrying
                * `available: false` is built. This card then rendered it as
                * "Bookings 0 · target 0 · —" — telling the MD the group sold nothing this month.
                *
                * withDeadline's own log line says "omitted from this response, not shown as zero".
                * The Sales card was the one place contradicting it.
                */}
              {b.available === false ? (
                <p className="text-xs font-semibold italic text-slate-400 py-2">Sales figures could not be read for this brand — not shown as zero.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <MiniStat label="Bookings" value={formatInt(b.bookings)} sub={`target ${formatInt(b.bookingTarget)} · ${formatPct(b.bookingAchievement)}`} />
                  <MiniStat label="Deliveries" value={formatInt(b.deliveries)} sub={`target ${formatInt(b.deliveryTarget)} · ${formatPct(b.deliveryAchievement)}`} />
                  <MiniStat label="Conversion" value={formatPct(b.conversion)} sub="bookings → deliveries" />
                  <MiniStat label="Consultants" value={formatInt(b.consultants)} sub="active this month" />
                </div>
              )}
              {b.available !== false && b.targetBasis === 'auto' && (
                <p className="mt-3 text-[10px] font-semibold text-slate-400">Targets auto-set: last month + 10% (no target configured for this month)</p>
              )}
            </Card>
          ))}
          <RetailCards />
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
                  {b.aged61To90 !== undefined && b.agedOver90 !== undefined && (
                    <p className="col-span-full flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] font-semibold text-slate-500">
                      <span>61–90 days <span className={cn('font-black tabular-nums', b.aged61To90 > 0 ? 'text-amber-700' : 'text-slate-700')}>{formatInt(b.aged61To90)}</span></span>
                      <span>Over 90 days <span className={cn('font-black tabular-nums', b.agedOver90 > 0 ? 'text-rose-700' : 'text-slate-700')}>{formatInt(b.agedOver90)}</span></span>
                    </p>
                  )}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <BigKpi icon={<Receipt className="h-5 w-5" />} label="Approved Vendor Payments" value={cashOk ? formatCurrency(cash.totals.vendorPaymentAmount) : '—'} sub={cashOk ? `${formatInt(cash.totals.vendorPaymentCount)} approved · cumulative` : 'could not be read — not shown as zero'} tone="from-slate-800 to-slate-700" />
        <BigKpi icon={<ShoppingCart className="h-5 w-5" />} label="Approved Purchase Orders" value={cashOk ? formatCurrency(cash.totals.poAmount) : '—'} sub={cashOk ? `${formatInt(cash.totals.poCount)} approved · cumulative` : 'could not be read — not shown as zero'} tone="from-cyan-800 to-cyan-700" />
        <BigKpi icon={<Wallet className="h-5 w-5" />} label="Approved Petty-Cash Spend" value={cashOk ? formatCurrency(cash.totals.spendAmount) : '—'} sub={cashOk ? `of ${formatCurrency(cash.totals.fundingAmount)} funding · cumulative` : 'could not be read — not shown as zero'} tone="from-teal-800 to-teal-700" />
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
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Banknote className="h-3.5 w-3.5" />vendor payments, POs + petty cash</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Approved vendor payments, purchase orders and petty cash by branch, cumulative to date.</caption>
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-50/60">
                <th scope="col" className="px-5 py-2.5 text-left">Branch</th>
                <th scope="col" className="px-5 py-2.5 text-right">Vendor payments</th>
                <th scope="col" className="px-5 py-2.5 text-right">Purchase orders</th>
                <th scope="col" className="px-5 py-2.5 text-right">PC funding</th>
                <th scope="col" className="px-5 py-2.5 text-right">PC spend</th>
              </tr>
            </thead>
            <tbody>
              {!cashOk ? (
                <tr><td className="px-5 py-8 text-center text-sm font-semibold italic text-rose-700" colSpan={5}>Approved cash could not be read this time — not shown as zero.</td></tr>
              ) : cash.brands.length === 0 ? (
                <tr><td className="px-5 py-8 text-center text-sm font-semibold text-slate-500" colSpan={5}>No approved cash activity.</td></tr>
              ) : cash.brands.map((b) => (
                <tr key={b.brand} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors">
                  <td className="px-5 py-3 text-left font-black text-slate-800">{b.brandLabel}</td>
                  <CashCell amount={b.vendorPaymentAmount} count={b.vendorPaymentCount} />
                  <CashCell amount={b.poAmount} count={b.poCount} />
                  <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-600 font-sans tabular-nums">{formatCurrency(b.spendAmount)}</td>
                </tr>
              ))}
              {cashOk && cash.brands.length > 0 && (
                <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                  <td className="px-5 py-3 text-left font-black text-slate-900">Group total</td>
                  <CashCell amount={cash.totals.vendorPaymentAmount} count={cash.totals.vendorPaymentCount} />
                  <CashCell amount={cash.totals.poAmount} count={cash.totals.poCount} />
                  <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(cash.totals.fundingAmount)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-700 font-sans tabular-nums">{formatCurrency(cash.totals.spendAmount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2 text-[10px] font-semibold italic text-slate-500">Cumulative approved to date: vendor payments once management approves them, POs once the MD approves them, petty cash by approval. Spend is paid out of funding, so the two are not added together. Group total excludes any unassigned-branch rows. Full detail in the CA section.</p>
      </Card>
    </div>
  )
}

/** The India report's names for the two Hyundai dealers, and how the dashboard labels them. */
const RETAIL_DEALERS = [
  { company: 'Jammu Automart Hyundai', label: 'AM Hyundai' },
  { company: 'Platinum Hyundai', label: 'AM Platinum' },
] as const

/**
 * Hyundai / Platinum retail from today's India snapshot — the same query (same key) the India section
 * below runs, so the page reads it once and the cards always match that table. Retail = delivery date
 * (owner, 2026-09-19). Their bookings and enquiries stay off the cockpit.
 */
function RetailCards() {
  const { data, isLoading, isError } = useIndiaSnapshot(indiaToday())
  const failed = isError || Boolean(data?.failed.includes('sales'))
  return (
    <>
      {RETAIL_DEALERS.map(({ company, label }) => {
        const row = data?.sales.find((r) => r.company === company)
        return (
          <Card key={`retail-${company}`} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--dashboard-action-bg)]" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">{label} Retail</h3>
            </div>
            {isLoading ? (
              <p className="flex items-center gap-2 py-2 text-xs font-semibold text-slate-400" aria-busy="true">
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Reading today’s India report…
              </p>
            ) : failed ? (
              <p className="text-xs font-semibold italic text-slate-400 py-2">Retail could not be read this time — not shown as zero.</p>
            ) : !row ? (
              <p className="text-xs font-semibold italic text-slate-400 py-2">No retail row for this dealer in today’s India report.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <MiniStat label="Retail" value={formatInt(row.retailMtd)} sub="delivered this month" />
                <MiniStat label="Today" value={formatInt(row.retailDay)} sub="delivered today" />
              </div>
            )}
            <p className="mt-3 text-[10px] font-semibold text-slate-400">By delivery date, from the daily India report below. Bookings are not shown for this brand.</p>
          </Card>
        )
      })}
    </>
  )
}

function CashCell({ amount, count }: { amount: number; count: number }) {
  return (
    <td className="px-5 py-3 text-right font-sans tabular-nums">
      <span className="block font-black text-slate-900">{formatCurrency(amount)}</span>
      <span className="block text-[11px] font-semibold text-slate-500">{formatInt(count)} approved</span>
    </td>
  )
}

/** "2026-09" -> "September 2026". */
function formatMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** Whole calendar days from `today` (YYYY-MM-DD, IST) to `day`. Negative = in the past. */
function daysFrom(today: string, day: string) {
  const utc = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(day) - utc(today)) / 86_400_000)
}

/** "14 Jul", or "14 Jul 2025" when the day is not in the current year. */
function formatDayWithYear(ymd: string, today: string) {
  const day = formatDay(ymd)
  return day && ymd.slice(0, 4) !== today.slice(0, 4) ? `${day} ${ymd.slice(0, 4)}` : day
}

function todayIst() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
}

function PanelHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-600">{title}</h2>
      <Link
        href={href}
        prefetch={false}
        className="shrink-0 rounded text-[11px] font-bold text-[var(--dashboard-action-bg)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)] focus-visible:ring-offset-2"
      >
        {linkLabel}
      </Link>
    </div>
  )
}

/** Everything waiting on the MD, by source — the MD Approvals section's own definition of "waiting". */
function MdQueuePanel({ queue, countedAt }: { queue: MdQueue; countedAt: string }) {
  const counted = formatAsOf(countedAt)
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="Waiting on you">
      <PanelHeader title="Waiting on you" href="/md-approvals" linkLabel="Open MD Approvals" />
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight text-slate-900 tabular-nums">{formatInt(queue.total)}</span>
        <span className="text-xs font-semibold text-slate-500">{queue.total === 1 ? 'item needs' : 'items need'} your approval</span>
      </p>
      {queue.total === 0 ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">Nothing is waiting on you right now.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {queue.sources.map((src) => (
            <li key={src.id} className="py-2">
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-bold text-slate-700">{src.label}</span>
                <span className="text-sm font-black text-slate-900 tabular-nums">{formatInt(src.count)}</span>
              </p>
              {src.count > 0 && (
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  {[
                    src.amount > 0 ? formatCurrency(src.amount) : null,
                    src.withoutAmount > 0 ? `${formatInt(src.withoutAmount)} with no value yet` : null,
                    src.oldestDays !== null ? `oldest ${src.oldestDays === 0 ? 'today' : `${src.oldestDays} days`}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto space-y-1 pt-3 text-[11px] font-semibold text-slate-500">
        {queue.byBranch.length > 0 && (
          <p>
            {queue.byBranch.slice(0, 5).map((b) => `${b.branchLabel} ${b.count}`).join(' · ')}
            {queue.byBranch.length > 5 ? ` · +${queue.byBranch.length - 5} more` : ''}
          </p>
        )}
        {/* The cockpit is rebuilt every 10 minutes, so this count can trail what was just approved. */}
        {counted && <p className="text-slate-400">Counted {counted}. MD Approvals shows the live list.</p>}
      </div>
    </section>
  )
}

/** Credit facilities already expired or expiring within 30 days. */
function BankFacilitiesPanel({ facilities }: { facilities: BankFacilities }) {
  const today = todayIst()
  const nothingDue = facilities.expired.count === 0 && facilities.expiringSoon.count === 0
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="Bank facilities">
      <PanelHeader title="Bank facilities" href="/bank-sanctions" linkLabel="Open Bank Sanctions" />
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <p className={cn('text-3xl font-black tracking-tight tabular-nums', facilities.expired.count > 0 ? 'text-rose-700' : 'text-slate-900')}>{formatInt(facilities.expired.count)}</p>
          <p className="text-[11px] font-semibold text-slate-500">expired{facilities.expired.count > 0 ? ` · ${formatCurrency(facilities.expired.creditLimit)}` : ''}</p>
        </div>
        <div>
          <p className={cn('text-3xl font-black tracking-tight tabular-nums', facilities.expiringSoon.count > 0 ? 'text-amber-700' : 'text-slate-900')}>{formatInt(facilities.expiringSoon.count)}</p>
          <p className="text-[11px] font-semibold text-slate-500">expire in {facilities.expiringSoon.withinDays} days{facilities.expiringSoon.count > 0 ? ` · ${formatCurrency(facilities.expiringSoon.creditLimit)}` : ''}</p>
        </div>
      </div>
      {nothingDue ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">None of the {formatInt(facilities.total)} facilities expires in the next {facilities.expiringSoon.withinDays} days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {facilities.items.slice(0, 4).map((f, i) => {
            const days = daysFrom(today, f.expiryDate)
            return (
              <li key={`${f.loanType}-${f.location}-${f.expiryDate}-${i}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-xs font-bold text-slate-700" title={`${f.loanType} · ${f.location}`}>{f.loanType}<span className="font-semibold text-slate-500"> · {f.location}</span></span>
                <span className="shrink-0 text-right text-[11px] font-semibold">
                  <span className={f.expired ? 'text-rose-700' : 'text-amber-700'}>
                    {f.expired ? `expired ${formatDayWithYear(f.expiryDate, today)}` : days === 0 ? 'expires today' : `in ${days} days · ${formatDay(f.expiryDate)}`}
                  </span>
                  {f.creditLimit !== null && <span className="block text-slate-500 tabular-nums">{formatCurrency(f.creditLimit)}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const SEVERITY_DOT: Record<DmsExceptions['byType'][number]['severity'], string> = {
  critical: 'bg-rose-600',
  high: 'bg-amber-500',
  medium: 'bg-slate-400',
}

/** KIA bookings the DMS disagrees with, for the current booking month. */
function DmsExceptionsPanel({ dms }: { dms: DmsExceptions }) {
  const lastRun = formatAsOf(dms.lastRunAt)
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="KIA DMS exceptions">
      <PanelHeader title="KIA DMS exceptions" href="/brands/kia/proforma/dms-exceptions" linkLabel="Open DMS Exceptions" />
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight text-slate-900 tabular-nums">{formatInt(dms.open)}</span>
        <span className="text-xs font-semibold text-slate-500">open for {formatMonth(dms.month).split(' ')[0]} bookings{dms.review > 0 ? `, including ${formatInt(dms.review)} to review` : ''}</span>
      </p>
      {dms.byType.length === 0 ? (
        <p className="mt-3 text-xs font-semibold text-slate-500">No open exceptions this month.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {dms.byType.slice(0, 5).map((t) => (
            <li key={t.type} className="flex items-baseline justify-between gap-3 py-2">
              <span className="flex min-w-0 items-baseline gap-2 text-xs font-bold text-slate-700">
                <span className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', SEVERITY_DOT[t.severity])} aria-hidden />
                <span>{t.label}</span>
                <span className="sr-only">({t.severity})</span>
              </span>
              <span className="text-sm font-black text-slate-900 tabular-nums">{formatInt(t.count)}</span>
            </li>
          ))}
        </ul>
      )}
      {dms.unmatchedDms > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-slate-500">
          Also {formatInt(dms.unmatchedDms)} DMS {dms.unmatchedDms === 1 ? 'booking has' : 'bookings have'} no matching booking here.
        </p>
      )}
      <p className={cn('mt-auto pt-3 text-[11px] font-semibold', dms.stale ? 'text-amber-700' : 'text-slate-500')}>
        {lastRun ? `Last matched ${lastRun}` : 'Not matched yet'}{dms.stale ? ' · the match is out of date' : ''}
      </p>
    </section>
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
