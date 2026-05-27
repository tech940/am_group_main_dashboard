'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Server,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { API_TIMING_EVENT, type ApiTimingEntry } from '@/lib/api/client-timing'
import { cn } from '@/lib/utils'

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return `${Math.round(value)}ms`
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function sourceClass(source: ApiTimingEntry['source']) {
  if (source === 'cache') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (source === 'db') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (source === 'mixed') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function healthTone(entry: ApiTimingEntry) {
  const total = entry.totalMs || 0
  if (!entry.ok || total >= 1500 || entry.slowestSqlMs >= 800) return 'risk'
  if (total >= 700 || entry.slowestSqlMs >= 350 || entry.sqlCount >= 10) return 'watch'
  return 'good'
}

function metricCard(label: string, value: string, sub: string, tone: 'good' | 'watch' | 'risk' | 'neutral') {
  return (
    <div className={cn(
      'rounded-2xl border p-4 shadow-sm',
      tone === 'good' && 'border-emerald-100 bg-emerald-50/70 text-emerald-900',
      tone === 'watch' && 'border-amber-100 bg-amber-50/70 text-amber-900',
      tone === 'risk' && 'border-rose-100 bg-rose-50/70 text-rose-900',
      tone === 'neutral' && 'border-slate-100 bg-slate-50 text-slate-900'
    )}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-65">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] font-bold opacity-75">{sub}</p>
    </div>
  )
}

export function PerformanceDiagnosticsPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [entries, setEntries] = useState<ApiTimingEntry[]>([])

  useEffect(() => {
    function onTiming(event: Event) {
      const detail = (event as CustomEvent<ApiTimingEntry>).detail
      if (!detail) return
      setEntries((current) => [detail, ...current].slice(0, 40))
    }

    window.addEventListener(API_TIMING_EVENT, onTiming)
    return () => window.removeEventListener(API_TIMING_EVENT, onTiming)
  }, [])

  const summary = useMemo(() => {
    const totalRequests = entries.length
    const slowRequests = entries.filter((entry) => healthTone(entry) !== 'good').length
    const dbRequests = entries.filter((entry) => entry.source === 'db' || entry.source === 'mixed').length
    const cacheHits = entries.filter((entry) => entry.source === 'cache').length
    const avgResponse = totalRequests
      ? entries.reduce((sum, entry) => sum + (entry.totalMs || 0), 0) / totalRequests
      : 0
    const avgSql = totalRequests
      ? entries.reduce((sum, entry) => sum + entry.sqlMs, 0) / totalRequests
      : 0
    const slowest = entries.reduce<ApiTimingEntry | null>((current, entry) => {
      if (!current) return entry
      return (entry.totalMs || 0) > (current.totalMs || 0) ? entry : current
    }, null)

    return { totalRequests, slowRequests, dbRequests, cacheHits, avgResponse, avgSql, slowest }
  }, [entries])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[220] flex justify-end bg-slate-950/45 p-3 backdrop-blur-sm">
      <div className="diagnostics-panel-shell flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-950 p-5 text-white lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-200">Admin Diagnostics</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Dashboard Health & Performance</h2>
              <p className="mt-1 text-xs font-semibold text-slate-300">
                Live timings from API responses in this browser session.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEntries([])}
              className="h-9 rounded-xl border-white/20 bg-white/10 text-xs font-black text-white hover:bg-white/15"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Clear
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-10 w-10 rounded-xl bg-white/10 text-white hover:bg-white/15"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="diagnostics-panel-body flex-1 overflow-auto bg-slate-50 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {metricCard('Requests Seen', summary.totalRequests.toLocaleString('en-IN'), 'last 40 API responses', 'neutral')}
            {metricCard('Avg Response', formatMs(summary.avgResponse), `${summary.slowRequests} need attention`, summary.slowRequests ? 'watch' : 'good')}
            {metricCard('Avg SQL Time', formatMs(summary.avgSql), `${summary.dbRequests} DB-backed requests`, summary.avgSql > 350 ? 'watch' : 'good')}
            {metricCard('Cache Hits', summary.cacheHits.toLocaleString('en-IN'), 'responses served without SQL', 'good')}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Performance Read</p>
                  <h3 className="text-lg font-black tracking-tight text-slate-950">What needs attention?</h3>
                </div>
                <Activity className="h-5 w-5 text-teal-700" />
              </div>
              {summary.slowest ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Slowest Request</p>
                    <p className="mt-2 text-xl font-black text-rose-950">{summary.slowest.label}</p>
                    <p className="mt-1 text-sm font-black text-rose-700">{formatMs(summary.slowest.totalMs)}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <Database className="mb-2 h-4 w-4 text-blue-700" />
                      <p className="text-[10px] font-black uppercase text-slate-400">SQL Queries</p>
                      <p className="text-lg font-black text-slate-950">{summary.slowest.sqlCount}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <Clock3 className="mb-2 h-4 w-4 text-amber-700" />
                      <p className="text-[10px] font-black uppercase text-slate-400">Slowest SQL</p>
                      <p className="text-lg font-black text-slate-950">{formatMs(summary.slowest.slowestSqlMs)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <Server className="mb-2 h-4 w-4 text-teal-700" />
                      <p className="text-[10px] font-black uppercase text-slate-400">Source</p>
                      <p className="text-lg font-black capitalize text-slate-950">{summary.slowest.source}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                  <Zap className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                  <p className="text-sm font-black text-slate-500">Open or refresh a section to capture API timings.</p>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Live Request Stream</p>
                <h3 className="text-lg font-black tracking-tight text-slate-950">Latest API timings</h3>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {entries.length ? (
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-950 text-white">
                      <tr>
                        {['Time', 'Endpoint', 'Source', 'Total', 'SQL', 'Rows', 'Health'].map((heading) => (
                          <th key={heading} className="px-3 py-3 text-[10px] font-black uppercase tracking-widest">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {entries.map((entry) => {
                        const tone = healthTone(entry)
                        return (
                          <tr key={entry.id} className="bg-white hover:bg-slate-50">
                            <td className="px-3 py-3 font-black text-slate-500">{formatTime(entry.recordedAt)}</td>
                            <td className="max-w-[240px] px-3 py-3">
                              <p className="truncate font-black text-slate-950" title={entry.label}>{entry.label}</p>
                              <p className="truncate text-[10px] font-semibold text-slate-400" title={entry.url}>{entry.status}</p>
                            </td>
                            <td className="px-3 py-3">
                              <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', sourceClass(entry.source))}>
                                {entry.source}
                              </span>
                            </td>
                            <td className="px-3 py-3 font-mono font-black text-slate-900">{formatMs(entry.totalMs)}</td>
                            <td className="px-3 py-3 font-mono font-black text-blue-700">{entry.sqlCount} / {formatMs(entry.sqlMs)}</td>
                            <td className="px-3 py-3 font-mono font-black text-slate-700">{entry.rowCount.toLocaleString('en-IN')}</td>
                            <td className="px-3 py-3">
                              <span className={cn(
                                'inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase',
                                tone === 'good' && 'bg-emerald-50 text-emerald-700',
                                tone === 'watch' && 'bg-amber-50 text-amber-700',
                                tone === 'risk' && 'bg-rose-50 text-rose-700'
                              )}>
                                {tone === 'good' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                                {tone}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center">
                    <Clock3 className="mx-auto mb-3 h-7 w-7 text-slate-300" />
                    <p className="text-sm font-black text-slate-500">No timings captured yet.</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">Change date, open a report, or refresh a section.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Reading The Panel</p>
            <div className="mt-3 grid gap-3 text-xs font-bold text-slate-600 md:grid-cols-3">
              <p><span className="font-black text-blue-700">DB</span> means SQL ran and can be optimized.</p>
              <p><span className="font-black text-emerald-700">Cache</span> means Redis served the response, so SQL time is expected to be zero.</p>
              <p><span className="font-black text-rose-700">Risk</span> means response time or a query crossed the slow threshold.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
