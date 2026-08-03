'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Copy, RefreshCw, XCircle } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CrossCheckResult, DataHealthReport, FeedHealth } from '@/lib/data-health/reader'

/**
 * Feed monitoring. Every panel answers one question the owner has actually asked this week:
 * "is this number wrong, or is the feed behind?"
 *
 * Deliberately blunt: a feed is either fine or it is not, and when it is not the row says WHAT
 * BREAKS in business terms rather than naming a column. Nobody opens a monitoring page to read
 * schema.
 */

const BRAND_LABEL: Record<FeedHealth['brand'], string> = {
  kia: 'AM Kia',
  hyundai: 'AM Hyundai',
  platinum: 'AM Platinum',
  group: 'Group',
}

const STATUS_STYLE: Record<FeedHealth['status'], { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'Healthy', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  stale: { label: 'Stale', className: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Clock },
  duplicates: { label: 'Duplicates', className: 'bg-rose-50 text-rose-700 border-rose-200', Icon: Copy },
  empty: { label: 'No data', className: 'bg-slate-100 text-slate-600 border-slate-300', Icon: AlertTriangle },
  error: { label: 'Error', className: 'bg-rose-100 text-rose-800 border-rose-300', Icon: XCircle },
}

function StatusPill({ status }: { status: FeedHealth['status'] }) {
  const style = STATUS_STYLE[status]
  const Icon = style.Icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em]', style.className)}>
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={cn('mt-1 text-2xl font-black tracking-tight', tone)}>{value}</div>
    </div>
  )
}

function FeedRow({ feed }: { feed: FeedHealth }) {
  const healthy = feed.status === 'ok'
  return (
    <tr className={cn('border-b border-slate-100 last:border-b-0', !healthy && 'bg-amber-50/30')}>
      <td className="px-4 py-3 align-top">
        <div className="font-bold text-slate-900">{feed.label}</div>
        <div className="mt-0.5 font-mono text-[10px] text-slate-400">{feed.table}</div>
      </td>
      <td className="px-4 py-3 align-top"><StatusPill status={feed.status} /></td>
      <td className="px-4 py-3 align-top text-slate-700">
        {feed.latestDate ? (
          <>
            <div className="font-semibold">{feed.latestDate}</div>
            <div className="text-[11px] text-slate-500">
              {feed.daysBehind === null ? '—' : feed.daysBehind <= 0 ? 'up to date' : `${feed.daysBehind}d behind`}
            </div>
          </>
        ) : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3 align-top text-right tabular-nums text-slate-700">
        {/* 0 means "the planner has no estimate" (views), not "no rows" — never print a bare 0. */}
        {feed.totalRows > 0 ? `~${feed.totalRows.toLocaleString('en-IN')}` : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-3 align-top text-right tabular-nums text-slate-700">
        {feed.rowsLast7Days.toLocaleString('en-IN')}
      </td>
      <td className="px-4 py-3 align-top text-right tabular-nums">
        {feed.duplicateRows === null
          ? <span className="text-slate-300" title="No unique business key on this feed — repeats here are legitimate">n/a</span>
          : feed.duplicateRows > 0
            ? <span className="font-black text-rose-700">{feed.duplicateRows.toLocaleString('en-IN')}</span>
            : <span className="text-emerald-600">0</span>}
      </td>
      <td className="px-4 py-3 align-top text-[11px] text-slate-500">
        {feed.error ? <span className="text-rose-600">{feed.error}</span> : !healthy ? feed.impact : ''}
      </td>
    </tr>
  )
}

function CrossCheckCard({ check }: { check: CrossCheckResult }) {
  const bad = check.status === 'mismatch'
  const rate = check.compared > 0 ? Math.round((check.mismatches / check.compared) * 100) : 0
  return (
    <div className={cn('rounded-2xl border p-4 shadow-xs', bad ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-bold text-slate-900">{check.label}</div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em]',
          bad ? 'bg-rose-200 text-rose-800' : 'bg-emerald-200 text-emerald-800')}>
          {bad ? `${rate}% disagree` : 'agrees'}
        </span>
      </div>
      <div className="mt-2 text-xs font-semibold text-slate-700">
        {check.mismatches.toLocaleString('en-IN')} of {check.compared.toLocaleString('en-IN')} shared records classified differently
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{check.description}</p>
      {check.error && <p className="mt-1.5 text-[11px] text-rose-600">{check.error}</p>}
    </div>
  )
}

export function DataHealthClient() {
  const { data, isLoading, isFetching, error, refetch } = useQuery<DataHealthReport>({
    queryKey: ['data-health'],
    queryFn: async () => {
      const res = await fetch('/api/data-health')
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to load data health')
      return res.json()
    },
    // The feeds land a few times a day; re-querying on every focus would be pure noise.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const brands: FeedHealth['brand'][] = ['kia', 'hyundai', 'platinum', 'group']

  return (
    <MainLayout title="Data Health" subtitle="Freshness, duplication and cross-feed agreement for every external source">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-xs font-medium text-slate-500">
            Every table below is loaded from outside this dashboard — DMS exports, insurance portals, the telephony
            provider. When a report looks wrong, check here first: a stale feed under-reports, and a duplicated one
            reports numbers that are confidently wrong.
          </p>
          <Button variant="outline" className="h-9 gap-1.5 rounded-xl text-xs font-bold"
            disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Checking…' : 'Re-check'}
          </Button>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
            {(error as Error).message}
          </div>
        )}

        {isLoading && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">Checking every feed…</div>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryTile label="Healthy" value={data.summary.ok} tone="text-emerald-600" />
              <SummaryTile label="Stale" value={data.summary.stale} tone="text-amber-600" />
              <SummaryTile label="Duplicated" value={data.summary.duplicates} tone="text-rose-600" />
              <SummaryTile label="No data" value={data.summary.empty} tone="text-slate-500" />
              <SummaryTile label="Feeds disagreeing" value={data.summary.mismatches} tone="text-rose-600" />
            </div>

            {brands.map((brand) => {
              const feeds = data.feeds.filter((f) => f.brand === brand)
              if (!feeds.length) return null
              return (
                <div key={brand} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
                    {BRAND_LABEL[brand]}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-white text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                          <th className="px-4 py-2.5">Feed</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Latest data</th>
                          <th className="px-4 py-2.5 text-right">Rows</th>
                          <th className="px-4 py-2.5 text-right">Last 7d</th>
                          <th className="px-4 py-2.5 text-right">Surplus</th>
                          <th className="px-4 py-2.5">What breaks</th>
                        </tr>
                      </thead>
                      <tbody>{feeds.map((feed) => <FeedRow key={feed.id} feed={feed} />)}</tbody>
                    </table>
                  </div>
                </div>
              )
            })}

            <div>
              <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">Cross-feed agreement</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.crossChecks.map((check) => <CrossCheckCard key={check.id} check={check} />)}
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Generated {new Date(data.generatedAt).toLocaleString('en-IN')} · freshness and duplication are measured
              over recent windows, not full history, so the page stays fast enough to actually open.
            </p>
          </>
        )}
      </div>
    </MainLayout>
  )
}
