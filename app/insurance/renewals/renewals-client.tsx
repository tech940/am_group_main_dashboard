'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Building2, CalendarClock, Download, IndianRupee, Search, ShieldCheck } from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BranchRenewalStats, RenewalBucket, RenewalDue, RenewalPipeline } from '@/lib/insurance/renewals'

/**
 * A CALLING LIST, not an analytics page. Sorted by urgency, filterable to one bucket, and
 * exportable — because the action this supports is "hand the team today's list", and until the
 * queue is wired into the call centre directly, CSV is how that happens.
 */

const BUCKETS: { id: RenewalBucket | 'all'; label: string; className: string }[] = [
  { id: 'all', label: 'All', className: 'bg-slate-900 text-white' },
  { id: 'lost', label: 'Lost (>30d lapsed)', className: 'bg-red-600 text-white' },
  { id: 'lapsed', label: 'Already lapsed', className: 'bg-rose-600 text-white' },
  { id: '30', label: 'Due ≤30 days', className: 'bg-amber-500 text-white' },
  { id: '60', label: '31–60 days', className: 'bg-sky-600 text-white' },
  { id: '90', label: '61–90 days', className: 'bg-emerald-600 text-white' },
]

const BUCKET_PILL: Record<RenewalBucket, string> = {
  lost: 'bg-red-50 text-red-700 border-red-200',
  lapsed: 'bg-rose-50 text-rose-700 border-rose-200',
  '30': 'bg-amber-50 text-amber-800 border-amber-200',
  '60': 'bg-sky-50 text-sky-700 border-sky-200',
  '90': 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const BRAND_LABEL: Record<string, string> = { hyundai: 'Hyundai', platinum: 'Platinum', kia: 'Kia' }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** Branch card — same KpiCard the Scrap dashboard uses, so the two sections read as one product. */
function BranchCard({ branch, onClick }: { branch: BranchRenewalStats; onClick: () => void }) {
  const urgent = branch.lapsed + branch.due30
  const share = branch.total > 0 ? Math.round((urgent / branch.total) * 100) : 0
  return (
    <KpiCard
      title={branch.dealerCode}
      value={branch.total.toLocaleString('en-IN')}
      subtitle={`${inr(branch.premiumAtRisk)} at risk · ${branch.brands.join(', ')}`}
      icon={Building2}
      // A branch is judged by how much of its book is already urgent, so the pill shows that share
      // rather than a period-on-period delta this queue has no basis to compute.
      trend={{ value: `${share}%`, isPositive: share < 40, label: 'lapsed or due ≤30d' }}
      colorScheme={share >= 60 ? 'rose' : share >= 40 ? 'amber' : 'emerald'}
      chartType="bar"
      chartData={branch.trend.length ? branch.trend : [0]}
      onClick={onClick}
    />
  )
}

export function RenewalsClient() {
  const [tab, setTab] = useState<'queue' | 'analytics'>('queue')
  const [bucket, setBucket] = useState<RenewalBucket | 'all'>('30')
  const [branch, setBranch] = useState<string>('all')
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery<RenewalPipeline>({
    queryKey: ['insurance-renewals'],
    queryFn: async () => {
      const res = await fetch('/api/insurance/renewals')
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to load the renewal pipeline')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.rows || []).filter((r) => {
      if (bucket !== 'all' && r.bucket !== bucket) return false
      if (branch !== 'all' && (r.dealerCode || 'UNASSIGNED') !== branch) return false
      if (!term) return true
      return `${r.customerName || ''} ${r.registrationNo || ''} ${r.chassisNo} ${r.model || ''}`.toLowerCase().includes(term)
    })
  }, [data, bucket, branch, search])

  // One shared sparkline series: expiries per week across the window. Summing the per-branch trends
  // is exact - every queued vehicle belongs to exactly one branch bucket.
  const weeklyTrend = useMemo(() => {
    const branches = data?.branches || []
    if (!branches.length) return [0]
    const width = Math.max(...branches.map((b) => b.trend.length))
    return Array.from({ length: width }, (_, i) => branches.reduce((sum, b) => sum + (b.trend[i] ?? 0), 0))
  }, [data])

  const lapsedShare = data && data.summary.total > 0
    ? Math.round((data.summary.lapsed / data.summary.total) * 100)
    : 0

  function exportCsv(list: RenewalDue[]) {
    const header = ['Expiry', 'Days', 'Bucket', 'Brand', 'Registration', 'Chassis', 'Customer', 'Model', 'Variant', 'Insurer', 'Last Premium', 'Dealer']
    const body = list.map((r) => [
      r.expiryDate, r.daysToExpiry, r.bucket, BRAND_LABEL[r.brand] || r.brand,
      r.registrationNo || '', r.chassisNo, r.customerName || '', r.model || '', r.variant || '',
      r.insuranceCompany || '', r.lastPremium ?? '', r.dealerCode || '',
    ])
    const csv = [header, ...body]
      .map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `insurance-renewals-${branch === 'all' ? 'all-branches' : branch}-${bucket}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <MainLayout title="Renewal Pipeline" subtitle="Vehicles whose insurance is due — a calling list, ordered by urgency">
      <div className="space-y-5">
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{(error as Error).message}</div>}
        {isLoading && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">Building the pipeline…</div>}

        {data && (
          <>
            <div className="flex gap-2">
              {(['queue', 'analytics'] as const).map((id) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn('rounded-xl px-4 py-2 text-xs font-black transition-all',
                    tab === id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                  {id === 'queue' ? 'Calling queue' : 'Branch analytics'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Already Lapsed" value={data.summary.lapsed.toLocaleString('en-IN')}
                subtitle="Expired in the last 30 days" icon={AlertTriangle} colorScheme="rose"
                chartType="bar" chartData={weeklyTrend}
                trend={{ value: `${lapsedShare}%`, isPositive: false, label: 'of the pipeline' }}
              />
              <KpiCard
                title="Due Within 30 Days" value={data.summary.due30.toLocaleString('en-IN')}
                subtitle="Call these first" icon={CalendarClock} colorScheme="amber"
                chartType="area" chartData={weeklyTrend}
                trend={{ value: data.summary.due60.toLocaleString('en-IN'), isPositive: true, label: 'more in 31-60d' }}
              />
              <KpiCard
                title="Premium At Risk" value={inr(data.summary.premiumAtRisk)}
                subtitle={`${data.summary.total.toLocaleString('en-IN')} vehicles across ${data.branches.length} branches`}
                icon={IndianRupee} colorScheme="purple" chartType="area" chartData={weeklyTrend}
              />
              <KpiCard
                title="Beyond 60 Days" value={data.summary.due90.toLocaleString('en-IN')}
                subtitle="Plan ahead, no call needed yet" icon={ShieldCheck} colorScheme="emerald"
                chartType="line" chartData={weeklyTrend}
              />
            </div>

            {tab === 'analytics' && (
              <div className="space-y-3">
                <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">By branch</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {data.branches.map((b) => (
                    <BranchCard key={b.dealerCode} branch={b}
                      onClick={() => { setBranch(b.dealerCode); setBucket('all'); setTab('queue') }} />
                  ))}
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">
                          <th className="px-4 py-2.5">Branch</th>
                          <th className="px-4 py-2.5">Brands</th>
                          <th className="px-4 py-2.5 text-right">Lapsed</th>
                          <th className="px-4 py-2.5 text-right">Due 30d</th>
                          <th className="px-4 py-2.5 text-right">31-60d</th>
                          <th className="px-4 py-2.5 text-right">61-90d</th>
                          <th className="px-4 py-2.5 text-right">Total</th>
                          <th className="px-4 py-2.5 text-right">Premium at risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.branches.map((b) => (
                          <tr key={b.dealerCode} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                            onClick={() => { setBranch(b.dealerCode); setBucket('all'); setTab('queue') }}>
                            <td className="px-4 py-3 font-bold text-slate-900">{b.dealerCode}</td>
                            <td className="px-4 py-3 text-[11px] text-slate-500">{b.brands.map((x) => BRAND_LABEL[x] || x).join(', ')}</td>
                            <td className="px-4 py-3 text-right font-bold tabular-nums text-rose-600">{b.lapsed}</td>
                            <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-600">{b.due30}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{b.due60}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{b.due90}</td>
                            <td className="px-4 py-3 text-right font-black tabular-nums text-slate-900">{b.total}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-700">{inr(b.premiumAtRisk)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'queue' && (<>
            <div className="flex flex-wrap items-center gap-2">
              {BUCKETS.map((b) => {
                const active = bucket === b.id
                return (
                  <button key={b.id} onClick={() => setBucket(b.id)}
                    className={cn('rounded-xl px-3 py-2 text-xs font-black transition-all',
                      active ? b.className : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50')}>
                    {b.label}
                  </button>
                )
              })}
              <select value={branch} onChange={(e) => setBranch(e.target.value)}
                className="ml-auto h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
                <option value="all">All branches</option>
                {(data.branches || []).map((b) => (
                  <option key={b.dealerCode} value={b.dealerCode}>{b.dealerCode} ({b.total})</option>
                ))}
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Customer, registration or model" className="h-10 w-64 rounded-xl pl-9 text-xs" />
              </div>
              <Button variant="outline" className="h-10 gap-1.5 rounded-xl text-xs font-bold"
                disabled={!rows.length} onClick={() => exportCsv(rows)}>
                <Download className="h-3.5 w-3.5" /> Export {rows.length}
              </Button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-2.5">Expiry</th>
                      <th className="px-4 py-2.5">Vehicle</th>
                      <th className="px-4 py-2.5">Customer</th>
                      <th className="px-4 py-2.5">Insurer</th>
                      <th className="px-4 py-2.5 text-right">Last premium</th>
                      <th className="px-4 py-2.5">Brand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 500).map((r) => (
                      <tr key={`${r.brand}-${r.chassisNo}`} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{r.expiryDate}</div>
                          <span className={cn('mt-1 inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]', BUCKET_PILL[r.bucket])}>
                            {r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)}d overdue` : `${r.daysToExpiry}d left`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{r.registrationNo || <span className="font-mono text-[10px] text-slate-500">{r.chassisNo}</span>}</div>
                          <div className="text-[11px] text-slate-500">{[r.model, r.variant].filter(Boolean).join(' · ') || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{r.customerName || '—'}</td>
                        <td className="px-4 py-3 text-[11px] text-slate-600">{r.insuranceCompany || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {r.lastPremium ? inr(Math.round(r.lastPremium)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-[11px] font-semibold text-slate-500">{BRAND_LABEL[r.brand] || r.brand}</td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-xs font-semibold text-slate-400">Nothing due in this bucket.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            </>)}

            {tab === 'queue' && rows.length > 500 && (
              <p className="text-[11px] font-semibold text-amber-700">
                Showing the 500 most urgent of {rows.length}. Export to get the full list — nothing is silently dropped from the CSV.
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              A renewal is counted off the own-damage policy, not the row — each vehicle carries a third-party
              companion policy that is not a separate renewal. One row per vehicle; Hyundai and Platinum
              duplicates are merged so no customer is called twice.
            </p>
          </>
        )}
      </div>
    </MainLayout>
  )
}
