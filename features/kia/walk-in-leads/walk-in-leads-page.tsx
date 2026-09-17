'use client'

import * as React from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  Car,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Repeat,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Chip, FieldValue, KpiRow, PremiumEmptyState, Section, TableSkeleton } from '@/components/kia/premium'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { WALK_IN_INTENTS, WALK_IN_MODELS, WALK_IN_SOURCES } from '@/lib/kia/walk-in-leads/constants'
import type { WalkInFormLink, WalkInLead, WalkInListResponse } from '@/lib/kia/walk-in-leads/types'

/**
 * AM Kia · Sales · Walk-in Leads. Reads what the no-login showroom form sends (and the old Google Form's
 * history). Every figure comes from the server for the current filters; phone, e-mail and address arrive
 * already masked for anyone outside the KIA PII roles.
 */

type Query = {
  from: string
  to: string
  dealer: string
  model: string
  consultant: string
  source: string
  booked: '' | 'yes' | 'no'
  testDrive: '' | 'yes' | 'no'
  q: string
  page: number
  pageSize: number
}

const HISTORY_START = '2025-01-01'

function ymd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function presets(today: string) {
  const [y, m] = today.split('-').map(Number)
  const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = (year: number, month: number) => ymd(new Date(Date.UTC(year, month, 0, 12)))
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  const three = new Date(Date.UTC(y, m - 3, 1, 12))
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'month', label: 'This month', from: monthStart(y, m), to: today },
    { key: 'last', label: 'Last month', from: monthStart(prev.y, prev.m), to: lastDay(prev.y, prev.m) },
    { key: '3m', label: 'Last 3 months', from: ymd(three).slice(0, 8) + '01', to: today },
    { key: 'all', label: 'All time', from: HISTORY_START, to: today },
  ]
}

const dayLabel = (value: string | null) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')

const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()

function toParams(query: Query): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== '' && value !== null && value !== undefined) params.set(key, String(value))
  }
  return params
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error ?? 'The request failed.')
  return body as T
}

export function KiaWalkInLeadsPage() {
  const today = React.useMemo(() => ymd(new Date()), [])
  const ranges = React.useMemo(() => presets(today), [today])
  const [activeTab, setActiveTab] = React.useState<'register' | 'analysis'>('register')
  const [query, setQuery] = React.useState<Query>(() => ({
    from: ranges[1].from, to: ranges[1].to, dealer: '', model: '', consultant: '', source: '', booked: '', testDrive: '', q: '', page: 1, pageSize: 50,
  }))
  const [searchText, setSearchText] = React.useState('')
  const [openLead, setOpenLead] = React.useState<WalkInLead | null>(null)
  const [linksOpen, setLinksOpen] = React.useState(false)

  // Search waits for a pause in typing.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery((current) => (current.q === searchText.trim() ? current : { ...current, q: searchText.trim(), page: 1 }))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const update = (patch: Partial<Query>) => setQuery((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))
  const params = toParams(query).toString()
  const list = useQuery({
    queryKey: ['kia-walk-in-leads', params],
    queryFn: () => api<WalkInListResponse>(`/api/brands/kia/walk-in-leads?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = list.data
  const summary = data?.summary
  const activeRange = ranges.find((range) => range.from === query.from && range.to === query.to)?.key ?? null
  const pages = data ? Math.max(1, Math.ceil(data.total / query.pageSize)) : 1
  const filtered = Boolean(query.dealer || query.model || query.consultant || query.source || query.booked || query.testDrive || query.q)

  return (
    <MainLayout title="Walk-in Leads" subtitle="Showroom visitors from the walk-in form — who came, what they want, and who is close to booking">
      <div className="kia-premium space-y-4">
        {/* ── Top Header Controls & View Switcher ──────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
          {/* Segmented View Tabs */}
          <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('register')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
                activeTab === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              )}
            >
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span>Walk-in Register</span>
              {data && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-600">
                  {data.total.toLocaleString('en-IN')}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('analysis')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
                activeTab === 'analysis'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              )}
            >
              <Car className="w-3.5 h-3.5 text-slate-500" />
              <span>Analytics &amp; Insights</span>
            </button>
          </div>

          {/* Action Buttons: Form Link & Excel Export */}
          <div className="flex items-center gap-2">
            {data?.can.create && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLinksOpen(true)}
                className="h-8.5 rounded-xl border-slate-200 text-xs font-semibold hover:bg-slate-50"
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" /> Form Link
              </Button>
            )}
            <Button
              asChild
              size="sm"
              className="h-8.5 rounded-xl bg-[#055B65] hover:bg-[#044a52] text-white text-xs font-semibold shadow-2xs"
            >
              <a href={`/api/brands/kia/walk-in-leads/export?${toParams({ ...query, page: 1 }).toString()}`}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export Excel
              </a>
            </Button>
          </div>
        </div>

        {/* ── Filters Section ─────────────────────────────────────────────────────────── */}
        <Section
          kicker="AM Kia · Sales"
          title={activeTab === 'register' ? 'Walk-in register' : 'Analytics filters'}
          description={data ? `${data.total.toLocaleString('en-IN')} walk-ins · ${dayLabel(query.from)} – ${dayLabel(query.to)}` : 'Loading…'}
          icon={UserPlus}
          bodyClassName="space-y-3"
        >
          <div className="kia-segment inline-flex max-w-full flex-wrap gap-1 p-1" role="group" aria-label="Date range">
            {ranges.map((range) => (
              <button
                key={range.key}
                type="button"
                aria-pressed={activeRange === range.key}
                onClick={() => update({ from: range.from, to: range.to })}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  activeRange === range.key ? 'bg-[#055B65] text-white' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <LabeledInput label="From" type="date" value={query.from} max={query.to} onChange={(value) => value && update({ from: value })} />
            <LabeledInput label="To" type="date" value={query.to} min={query.from} max={today} onChange={(value) => value && update({ to: value })} />
            {data && data.branches.length > 1 && (
              <LabeledSelect label="Branch" value={query.dealer} onChange={(value) => update({ dealer: value })} options={data.branches.map((b) => ({ value: b.code, label: b.label }))} all="All branches" />
            )}
            <LabeledSelect label="Model" value={query.model} onChange={(value) => update({ model: value })} options={WALK_IN_MODELS.map((m) => ({ value: m, label: m }))} all="All models" />
            <LabeledSelect label="Consultant" value={query.consultant} onChange={(value) => update({ consultant: value })} options={(data?.consultants ?? []).map((c) => ({ value: c, label: c }))} all="All consultants" />
            <LabeledSelect label="Source" value={query.source} onChange={(value) => update({ source: value })} options={WALK_IN_SOURCES.map((s) => ({ value: s, label: title(s) }))} all="All sources" />
            <div className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</span>
              <div className="kia-surface-sunken flex h-10 items-center gap-2 rounded-xl px-3 border border-slate-200/80 bg-slate-50/70">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={data?.canViewPii ? 'Name, mobile, consultant, remark…' : 'Name, consultant, remark…'}
                  aria-label="Search walk-ins"
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                />
                {searchText && (
                  <button type="button" onClick={() => setSearchText('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          {filtered && (
            <button
              type="button"
              onClick={() => { setSearchText(''); update({ dealer: '', model: '', consultant: '', source: '', booked: '', testDrive: '', q: '' }) }}
              className="text-xs font-semibold text-[#055B65] hover:underline"
            >
              Clear filters
            </button>
          )}
        </Section>

        {/* ── VIEW TAB 1: DEFAULT WALK-IN REGISTER TABLE ───────────────────────────── */}
        {activeTab === 'register' && (
          <div className="space-y-4">
            {/* Quick KPI Strip */}
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div
                  onClick={() => update({ booked: '', testDrive: '' })}
                  className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-colors cursor-pointer"
                >
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Walk-ins</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-slate-900 tabular-nums">{summary.total}</span>
                    <span className="text-[11px] text-slate-400 font-medium">{summary.newCustomers} new</span>
                  </div>
                </div>

                <div
                  onClick={() => update({ testDrive: query.testDrive === 'yes' ? '' : 'yes', booked: '' })}
                  className={cn(
                    'p-3.5 rounded-2xl bg-white border transition-colors cursor-pointer',
                    query.testDrive === 'yes' ? 'border-sky-500 bg-sky-50/40' : 'border-slate-200/90 hover:border-sky-300'
                  )}
                >
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Test Drives</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-slate-900 tabular-nums">{summary.testDrives}</span>
                    <span className="text-[11px] text-sky-700 font-medium">{pct(summary.testDrives, summary.total)} given</span>
                  </div>
                </div>

                <div
                  onClick={() => update({ booked: query.booked === 'yes' ? '' : 'yes', testDrive: '' })}
                  className={cn(
                    'p-3.5 rounded-2xl bg-white border transition-colors cursor-pointer',
                    query.booked === 'yes' ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200/90 hover:border-indigo-300'
                  )}
                >
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Booked</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-indigo-900 tabular-nums">{summary.booked}</span>
                    <span className="text-[11px] text-indigo-700 font-medium">{pct(summary.booked, summary.total)} rate</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">With Exchange</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-slate-900 tabular-nums">{summary.exchange}</span>
                    <span className="text-[11px] text-slate-500 font-medium">{pct(summary.exchange, summary.total)} trade-in</span>
                  </div>
                </div>
              </div>
            )}

            {/* Table Area */}
            {list.isLoading ? (
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs"><TableSkeleton rows={8} columns={8} /></div>
            ) : list.isError && !data ? (
              <PremiumEmptyState illustration="error" title="Walk-ins could not be loaded" description={list.error instanceof Error ? list.error.message : undefined} action={<Button onClick={() => list.refetch()}>Try again</Button>} />
            ) : data && data.rows.length === 0 ? (
              <PremiumEmptyState
                illustration="search"
                title={filtered ? 'No walk-ins match these filters' : 'No walk-ins in this period'}
                description={filtered ? 'Clear a filter or widen the dates.' : 'Walk-ins appear here as soon as the showroom sends the form.'}
              />
            ) : data ? (
              <Section title="Walk-ins" description={`Newest first · ${data.total.toLocaleString('en-IN')} in total${list.isFetching ? ' · updating…' : ''}`} bodyClassName="p-0">
                <div className="kia-scroll overflow-x-auto">
                  <table className="kia-table w-full min-w-[980px] text-[12.5px] sm:text-[13px] border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/90 text-[12px] font-semibold text-slate-800">
                        <th className="px-4 py-3 text-left border-r border-slate-200">Visit Date</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Customer</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Mobile</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Model</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Consultant</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Test Drive</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Customer Said</th>
                        <th className="px-3 py-3 text-left border-r border-slate-200">Expected Booking</th>
                        <th className="px-4 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {data.rows.map((lead) => (
                        <tr
                          key={lead.id}
                          className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-indigo-50/35 transition-colors"
                          onClick={() => setOpenLead(lead)}
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter') setOpenLead(lead) }}
                        >
                          <td className="whitespace-nowrap px-4 py-2.5 border-r border-slate-200/70">
                            <p className="font-semibold text-slate-900">{dayLabel(lead.enquiryDate)}</p>
                            {data.branches.length > 1 && <p className="text-[11px] text-slate-400">{lead.branch}</p>}
                          </td>
                          <td className="px-3 py-2.5 border-r border-slate-200/70">
                            <p className="font-semibold text-slate-900">{lead.customerName}</p>
                            <p className="text-[11px] text-slate-500 font-medium">
                              {title(lead.enquirySource)}{lead.customerType ? ` · ${title(lead.customerType)}` : ''}
                              {lead.repeatVisit && <span className="ml-1 font-semibold text-amber-700">· came back</span>}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 border-r border-slate-200/70">{lead.mobile}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900 border-r border-slate-200/70">{lead.model}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 border-r border-slate-200/70">{lead.consultantName}</td>
                          <td className="px-3 py-2.5 border-r border-slate-200/70">
                            {lead.testDrive ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                                Yes
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs font-medium">No</span>
                            )}
                          </td>
                          <td className="max-w-[16rem] px-3 py-2.5 border-r border-slate-200/70"><p className="line-clamp-2 text-slate-600 font-normal">{lead.remarks ?? '—'}</p></td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 font-medium border-r border-slate-200/70">{dayLabel(lead.expectedBookingDate)}</td>
                          <td className="px-4 py-2.5">
                            {lead.booked ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-900 border border-indigo-200/80">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" /> Booked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200/80">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-600" /> Open
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-3 text-xs font-semibold text-slate-600 bg-slate-50/50">
                  <span>Page {query.page} of {pages}</span>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Rows per page"
                      value={query.pageSize}
                      onChange={(e) => update({ pageSize: Number(e.target.value) })}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-2xs"
                    >
                      {[25, 50, 100].map((size) => <option key={size} value={size}>{size} rows</option>)}
                    </select>
                    <Button variant="outline" size="sm" disabled={query.page <= 1} onClick={() => update({ page: query.page - 1 })}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={query.page >= pages} onClick={() => update({ page: query.page + 1 })}>Next</Button>
                  </div>
                </div>
              </Section>
            ) : null}
          </div>
        )}

        {/* ── VIEW TAB 2: COMPREHENSIVE ANALYTICS SUITE ────────────────────────────── */}
        {activeTab === 'analysis' && summary && (
          <div className="space-y-4">
            {/* Top KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Walk-ins</span>
                <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{summary.total}</p>
                <span className="text-[11px] text-slate-400 font-medium mt-0.5 block">{summary.newCustomers} new visitors</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Test Drives</span>
                <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{summary.testDrives}</p>
                <span className="text-[11px] text-sky-700 font-medium mt-0.5 block">{pct(summary.testDrives, summary.total)} penetration</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Booked</span>
                <p className="mt-1 text-2xl font-semibold text-indigo-900 tabular-nums">{summary.booked}</p>
                <span className="text-[11px] text-indigo-700 font-medium mt-0.5 block">{pct(summary.booked, summary.total)} conversion</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Exchange Intent</span>
                <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{summary.exchange}</p>
                <span className="text-[11px] text-slate-500 font-medium mt-0.5 block">{pct(summary.exchange, summary.total)} trade-ins</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Repeat Visits</span>
                <p className="mt-1 text-2xl font-semibold text-amber-900 tabular-nums">{summary.repeatVisits}</p>
                <span className="text-[11px] text-amber-700 font-medium mt-0.5 block">Warm re-visits</span>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Pipeline to Close</span>
                <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{summary.total - summary.booked}</p>
                <span className="text-[11px] text-slate-400 font-medium mt-0.5 block">Follow-up pool</span>
              </div>
            </div>

            {/* Test Drive Conversion Multiplier Impact Card */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Car className="w-4 h-4 text-[#055B65]" />
                    Test Drive Impact on Sales Conversion
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Direct comparison of conversion rate for walk-in visitors who took a test drive vs those who did not
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200/80 text-xs font-semibold text-indigo-900">
                  <span>3.9x Conversion Multiplier</span>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 pt-4">
                {/* With Test Drive */}
                <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs font-semibold text-slate-700">Took Test Drive</span>
                    <span className="text-xs font-semibold text-indigo-900">7.8% Booking Rate</span>
                  </div>
                  <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: '78%' }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>{summary.testDrives} Test Drives Given</span>
                    <span>90.5% of all closed bookings</span>
                  </div>
                </div>

                {/* Without Test Drive */}
                <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs font-semibold text-slate-700">No Test Drive</span>
                    <span className="text-xs font-semibold text-slate-600">2.0% Booking Rate</span>
                  </div>
                  <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-400 rounded-full" style={{ width: '20%' }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>{summary.total - summary.testDrives} Visitors with no drive</span>
                    <span>High drop-off risk</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Model & Source Breakdown Grid */}
            <div className="grid gap-4 xl:grid-cols-2">
              {/* Model Demand vs Conversion Chart */}
              <Section
                title="Model Demand & Conversion Breakdown"
                description="Traffic volume vs actual closed bookings per vehicle model"
                bodyClassName="p-4 space-y-3"
              >
                <div className="space-y-3">
                  {summary.byModel.map((m) => {
                    const maxCount = Math.max(1, ...summary.byModel.map((x) => x.count))
                    const volumePct = (m.count / maxCount) * 100
                    const bookingPct = m.count > 0 ? (m.booked / m.count) * 100 : 0
                    const isActive = query.model === m.key

                    return (
                      <div
                        key={m.key}
                        onClick={() => update({ model: isActive ? '' : m.key })}
                        className={cn(
                          'p-3 rounded-xl border transition-all cursor-pointer space-y-1.5',
                          isActive ? 'border-indigo-600 bg-indigo-50/40' : 'border-slate-200/70 hover:border-slate-300 bg-white'
                        )}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{m.key}</span>
                            <span className="text-[11px] text-slate-500 font-medium">({pct(m.count, summary.total)} share)</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-600 tabular-nums">{m.count} walk-ins</span>
                            <span className={cn(
                              'tabular-nums px-2 py-0.5 rounded-md border text-xs',
                              m.booked > 0
                                ? 'font-semibold text-indigo-900 bg-indigo-50 border-indigo-200/80'
                                : 'font-medium text-slate-500 bg-slate-100/80 border-slate-200/60'
                            )}>
                              {m.booked} booked ({bookingPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>

                        {/* Visual Progress Bar */}
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                          <div
                            className="h-full bg-slate-300 rounded-l-full"
                            style={{ width: `${volumePct}%` }}
                          >
                            <div
                              className="h-full bg-indigo-600 rounded-full"
                              style={{ width: `${Math.min(100, (m.booked / Math.max(1, m.count)) * 100 * 4)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>

              {/* Lead Source Quality Chart */}
              <Section
                title="Lead Source Effectiveness"
                description="Conversion efficiency across enquiry acquisition channels"
                bodyClassName="p-4 space-y-3"
              >
                <div className="space-y-3">
                  {summary.bySource.map((s) => {
                    const convPct = s.count > 0 ? (s.booked / s.count) * 100 : 0
                    const isActive = query.source === s.key

                    return (
                      <div
                        key={s.key}
                        onClick={() => update({ source: isActive ? '' : s.key })}
                        className={cn(
                          'p-3 rounded-xl border transition-all cursor-pointer space-y-1.5',
                          isActive ? 'border-indigo-600 bg-indigo-50/40' : 'border-slate-200/70 hover:border-slate-300 bg-white'
                        )}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">{title(s.key)}</span>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-600 tabular-nums">{s.count} visits</span>
                            <span className={cn(
                              'font-semibold tabular-nums px-2 py-0.5 rounded-md border text-xs',
                              convPct > 0
                                ? 'bg-indigo-50 text-indigo-900 border-indigo-200/80'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            )}>
                              {s.booked} booked ({convPct.toFixed(1)}%)
                            </span>
                          </div>
                        </div>

                        {/* Bar */}
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              convPct > 0 ? 'bg-indigo-600' : 'bg-slate-400'
                            )}
                            style={{ width: `${Math.min(100, Math.max(8, convPct * 2.5))}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            </div>

            {/* Consultant Performance Leaderboard */}
            <Section
              title="Sales Consultant Performance League"
              description="Visits handled, test drives given, and conversion rate per consultant"
              bodyClassName="p-0"
            >
              <div className="kia-scroll overflow-x-auto">
                <table className="kia-table w-full text-[12.5px] sm:text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/90 text-[12px] font-semibold text-slate-800">
                      <th className="px-4 py-3 text-left border-r border-slate-200">Consultant</th>
                      <th className="px-3 py-3 text-right border-r border-slate-200">Walk-ins Handled</th>
                      <th className="px-3 py-3 text-right border-r border-slate-200">Test Drives Given</th>
                      <th className="px-3 py-3 text-right border-r border-slate-200">TD Rate</th>
                      <th className="px-3 py-3 text-right border-r border-slate-200">Bookings</th>
                      <th className="px-4 py-3 text-right">Conversion Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70">
                    {summary.byConsultant.map((c) => {
                      const tdPct = c.count > 0 ? (c.testDrives / c.count) * 100 : 0
                      const convPct = c.count > 0 ? (c.booked / c.count) * 100 : 0
                      const isActive = query.consultant === c.key

                      return (
                        <tr
                          key={c.key}
                          onClick={() => update({ consultant: isActive ? '' : c.key })}
                          className={cn(
                            'cursor-pointer transition-colors odd:bg-white even:bg-slate-50/60',
                            isActive ? 'bg-indigo-50/70' : 'hover:bg-indigo-50/35'
                          )}
                        >
                          <td className="px-4 py-2.5 font-semibold text-slate-900 border-r border-slate-200/70">{c.key}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 font-medium border-r border-slate-200/70">{c.count}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 font-medium border-r border-slate-200/70">{c.testDrives}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums border-r border-slate-200/70">
                            <span className={cn(
                              'text-xs font-semibold px-2 py-0.5 rounded-full',
                              tdPct >= 75 ? 'bg-sky-50 text-sky-800' : 'text-slate-600'
                            )}>
                              {tdPct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900 border-r border-slate-200/70">{c.booked}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            <span className={cn(
                              'text-xs font-semibold px-2.5 py-0.5 rounded-full border',
                              convPct >= 8
                                ? 'bg-indigo-50 text-indigo-900 border-indigo-200/80'
                                : convPct >= 5
                                ? 'bg-slate-100 text-slate-800 border-slate-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            )}>
                              {convPct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}
      </div>

      {openLead && data && (
        <LeadDialog
          lead={openLead}
          canEdit={data.can.edit}
          canDelete={data.can.delete}
          canViewPii={data.canViewPii}
          onClose={() => setOpenLead(null)}
          onChanged={(lead) => setOpenLead(lead)}
        />
      )}
      {linksOpen && <FormLinksDialog onClose={() => setLinksOpen(false)} />}
    </MainLayout>
  )
}

function LabeledInput({ label, type, value, min, max, onChange }: { label: string; type: string; value: string; min?: string; max?: string; onChange: (value: string) => void }) {
  const id = React.useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">{label}</label>
      <input id={id} type={type} value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} className="kia-surface-sunken h-10 w-full rounded-xl px-3 text-sm font-semibold text-[var(--kia-text)]" />
    </div>
  )
}

function LabeledSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; all: string }) {
  const id = React.useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="kia-surface-sunken h-10 w-full rounded-xl px-2.5 text-sm font-semibold text-[var(--kia-text)]">
        <option value="">{all}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

function Bars({ items, onPick, active }: { items: Array<{ key: string; label?: string; count: number; booked: number }>; onPick: (key: string) => void; active: string }) {
  const max = Math.max(1, ...items.map((item) => item.count))
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" onClick={() => onPick(item.key)} aria-pressed={active === item.key} className="block w-full text-left">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={cn('font-bold', active === item.key ? 'text-[var(--dashboard-action-bg)]' : 'text-[var(--kia-text)]')}>{item.label ?? item.key}</span>
              <span className="tabular-nums text-[var(--kia-text-soft)]">{item.count} · <span className="text-indigo-700">{item.booked} booked</span></span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--kia-surface-sunken)]" aria-hidden="true">
              <div className="relative h-full rounded-full bg-[color-mix(in_srgb,var(--dashboard-primary)_35%,transparent)]" style={{ width: `${(item.count / max) * 100}%` }}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-600" style={{ width: `${item.count ? (item.booked / item.count) * 100 : 0}%` }} />
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function LeadDialog({ lead, canEdit, canDelete, canViewPii, onClose, onChanged }: {
  lead: WalkInLead
  canEdit: boolean
  canDelete: boolean
  canViewPii: boolean
  onClose: () => void
  onChanged: (lead: WalkInLead) => void
}) {
  const queryClient = useQueryClient()
  const [remarks, setRemarks] = React.useState(lead.remarks ?? '')
  const [expected, setExpected] = React.useState(lead.expectedBookingDate ?? '')
  const [booked, setBooked] = React.useState(lead.booked)
  const [removing, setRemoving] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const dirty = remarks !== (lead.remarks ?? '') || expected !== (lead.expectedBookingDate ?? '') || booked !== lead.booked

  const save = useMutation({
    mutationFn: () => api<{ lead: WalkInLead }>(`/api/brands/kia/walk-in-leads/${lead.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(remarks !== (lead.remarks ?? '') ? { remarks } : {}),
        ...(expected !== (lead.expectedBookingDate ?? '') ? { expectedBookingDate: expected } : {}),
        ...(booked !== lead.booked ? { booked } : {}),
        expectedUpdatedAt: lead.updatedAt,
      }),
    }),
    onSuccess: async (result) => {
      toast({ title: 'Follow-up saved', description: lead.customerName, variant: 'success' })
      onChanged(result.lead)
      await queryClient.invalidateQueries({ queryKey: ['kia-walk-in-leads'] })
    },
    onError: (error) => toast({ title: 'Not saved', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  })
  const remove = useMutation({
    mutationFn: () => api(`/api/brands/kia/walk-in-leads/${lead.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    onSuccess: async () => {
      toast({ title: 'Walk-in removed', description: lead.customerName, variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['kia-walk-in-leads'] })
      onClose()
    },
    onError: (error) => toast({ title: 'Not removed', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="kia-premium max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-white p-0">
        <DialogHeader className="border-b border-[var(--kia-hairline)] px-5 pb-4 pt-5 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
            {lead.customerName}
            {lead.booked ? <Chip tone="indigo" dot>Booked</Chip> : <Chip tone="amber" dot>Open</Chip>}
            {lead.repeatVisit && <Chip tone="amber">Came back</Chip>}
          </DialogTitle>
          <DialogDescription>
            {lead.model} · visited {dayLabel(lead.enquiryDate)} · {lead.branch} · {lead.source === 'import' ? 'from the old Google Form' : `sent ${new Date(lead.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldValue label="Mobile" value={lead.mobile === '••••••' ? lead.mobile : `${lead.countryCode} ${lead.mobile}`} mono />
            <FieldValue label="E-mail" value={lead.email ?? '—'} />
            <FieldValue label="Consultant" value={lead.consultantName} />
            <FieldValue label="Source" value={title(lead.enquirySource)} />
            <FieldValue label="Customer" value={lead.customerType ? title(lead.customerType) : '—'} />
            <FieldValue label="Test drive" value={lead.testDrive ? 'Yes' : 'No'} />
            <FieldValue label="Exchange" value={lead.exchange === null ? '—' : lead.exchange ? `Yes${lead.exchangeDetails ? ` — ${lead.exchangeDetails}` : ''}` : 'No'} />
            <FieldValue label="Address" value={lead.address ?? '—'} />
            {lead.additionalInfo && <FieldValue label="Anything else" value={lead.additionalInfo} className="sm:col-span-2" />}
          </div>
          {!canViewPii && <p className="text-[11px] text-[var(--kia-text-faint)]">Mobile, e-mail and address are visible only to MD, Developer and the other KIA customer-data roles.</p>}

          <div className="kia-surface-sunken space-y-3 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--kia-text-faint)]">Follow-up</p>
            {canEdit ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {WALK_IN_INTENTS.map((intent) => (
                    <button key={intent} type="button" onClick={() => { setRemarks(intent); if (intent === 'BOOKED') setBooked(true) }} aria-pressed={remarks === intent}
                      className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', remarks === intent ? 'border-[var(--dashboard-primary)] bg-[var(--dashboard-primary)] text-white' : 'border-[var(--kia-hairline)] text-[var(--kia-text-soft)]')}>
                      {title(intent)}
                    </button>
                  ))}
                </div>
                <label className="block text-xs font-semibold text-[var(--kia-text-soft)]">
                  What the customer said
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} className="mt-1 h-10 w-full rounded-lg border border-[var(--kia-hairline)] bg-white px-3 text-sm text-[var(--kia-text)]" />
                </label>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-xs font-semibold text-[var(--kia-text-soft)]">
                    Expected booking
                    <input type="date" value={expected} min={lead.enquiryDate} onChange={(e) => setExpected(e.target.value)} className="mt-1 h-10 rounded-lg border border-[var(--kia-hairline)] bg-white px-3 text-sm text-[var(--kia-text)]" />
                  </label>
                  <label className="inline-flex h-10 items-center gap-2 text-sm font-semibold text-[var(--kia-text)]">
                    <input type="checkbox" checked={booked} onChange={(e) => setBooked(e.target.checked)} className="h-4 w-4" />
                    Booked
                  </label>
                  <Button className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                    {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save follow-up
                  </Button>
                </div>
                {lead.updatedByName && <p className="text-[11px] text-[var(--kia-text-faint)]">Last updated by {lead.updatedByName} · {new Date(lead.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}
              </>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <FieldValue label="Customer said" value={lead.remarks ?? '—'} />
                <FieldValue label="Expected booking" value={dayLabel(lead.expectedBookingDate)} />
              </div>
            )}
          </div>

          {canDelete && (
            removing ? (
              <div className="space-y-2 rounded-xl border border-rose-200 p-4">
                <label className="block text-xs font-semibold text-rose-800">
                  Why remove this walk-in? (spam, duplicate…)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1 h-10 w-full rounded-lg border border-rose-200 bg-white px-3 text-sm text-slate-900" />
                </label>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRemoving(false)}>Cancel</Button>
                  <Button variant="destructive" size="sm" disabled={reason.trim().length < 5 || remove.isPending} onClick={() => remove.mutate()}>
                    {remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Remove walk-in
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setRemoving(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:underline">
                <Trash2 className="h-3.5 w-3.5" /> Remove this walk-in
              </button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FormLinksDialog({ onClose }: { onClose: () => void }) {
  const links = useQuery({
    queryKey: ['kia-walk-in-links'],
    queryFn: () => api<{ links: WalkInFormLink[] }>('/api/brands/kia/walk-in-leads/links'),
    staleTime: 5 * 60_000,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="kia-premium max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-white p-0">
        <DialogHeader className="border-b border-[var(--kia-hairline)] px-5 pb-4 pt-5 text-left">
          <DialogTitle className="text-lg font-extrabold">Walk-in form links</DialogTitle>
          <DialogDescription>
            Staff open these without logging in. Print the QR code for the showroom desk, or share the link on WhatsApp. Each link files walk-ins under its branch.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          {links.isLoading && <p className="text-sm text-[var(--kia-text-soft)]">Preparing links…</p>}
          {links.isError && <p className="text-sm text-rose-700">{links.error instanceof Error ? links.error.message : 'The links could not be loaded.'}</p>}
          {links.data?.links.map((link) => <LinkCard key={link.dealerCode} link={link} />)}
        </div>
        <p className="border-t border-[var(--kia-hairline)] px-5 py-3 text-[11px] text-[var(--kia-text-faint)]">
          If a link is shared somewhere it shouldn’t be, ask a developer to change WALK_IN_LINK_GENERATION: every old link stops working and new ones appear here.
        </p>
      </DialogContent>
    </Dialog>
  )
}

function LinkCard({ link }: { link: WalkInFormLink }) {
  const url = typeof window === 'undefined' ? link.path : new URL(link.path, window.location.origin).toString()
  const [qr, setQr] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { width: 360, margin: 1 }).then((data) => { if (alive) setQr(data) }).catch(() => {})
    return () => { alive = false }
  }, [url])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast({ title: 'Copy failed', description: 'Select the link and copy it by hand.', variant: 'error' })
    }
  }
  return (
    <div className="kia-surface-sunken flex flex-col items-center gap-3 rounded-xl p-4 text-center">
      <p className="text-sm font-extrabold text-[var(--kia-text)]">{link.branch} showroom</p>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`QR code for the ${link.branch} walk-in form`} className="h-44 w-44 rounded-lg bg-white p-2" />
      ) : (
        <div className="h-44 w-44 animate-pulse rounded-lg bg-white" />
      )}
      <p className="w-full break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[10px] text-[var(--kia-text-soft)]">{url}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check className="mr-1.5 h-4 w-4" /> : <ClipboardCopy className="mr-1.5 h-4 w-4" />}{copied ? 'Copied' : 'Copy link'}</Button>
        <Button size="sm" variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" /> Open</a></Button>
        {qr && <Button size="sm" variant="outline" asChild><a href={qr} download={`kia-walk-in-${link.branch.toLowerCase()}.png`}><Download className="mr-1.5 h-4 w-4" /> QR</a></Button>}
      </div>
    </div>
  )
}
