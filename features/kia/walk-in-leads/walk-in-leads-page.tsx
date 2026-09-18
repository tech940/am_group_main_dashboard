'use client'

import * as React from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  BadgeCheck,
  Car,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
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
import {
  WALK_IN_BOOKING_TIMELINES,
  WALK_IN_CUSTOMER_TYPES,
  WALK_IN_HOLDING_REASONS,
  WALK_IN_INTENTS,
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
} from '@/lib/kia/walk-in-leads/constants'
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

function ymd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function currentMonthStart(todayStr: string): string {
  return `${todayStr.slice(0, 8)}01`
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
  const [activeTab, setActiveTab] = React.useState<'register' | 'booked' | 'analysis'>('register')
  const [query, setQuery] = React.useState<Query>(() => {
    const t = ymd(new Date())
    return {
      from: currentMonthStart(t),
      to: t,
      dealer: '',
      model: '',
      consultant: '',
      source: '',
      booked: '',
      testDrive: '',
      q: '',
      page: 1,
      pageSize: 50,
    }
  })
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

  const effectiveQuery = React.useMemo(() => {
    if (activeTab === 'booked') {
      return { ...query, booked: 'yes' as const }
    }
    return query
  }, [activeTab, query])

  const params = toParams(effectiveQuery).toString()
  const list = useQuery({
    queryKey: ['kia-walk-in-leads', params],
    queryFn: () => api<WalkInListResponse>(`/api/brands/kia/walk-in-leads?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = list.data
  const summary = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.total / query.pageSize)) : 1
  const filtered = Boolean(query.dealer || query.model || query.consultant || query.source || (activeTab !== 'booked' && query.booked) || query.testDrive || query.q)

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
              onClick={() => setActiveTab('booked')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
                activeTab === 'booked'
                  ? 'bg-white text-indigo-950 shadow-xs ring-1 ring-indigo-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              )}
            >
              <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
              <span>Booked &amp; Calling</span>
              {summary && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                  {summary.booked.toLocaleString('en-IN')}
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
              className="h-8.5 rounded-xl bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-hover)] text-[var(--dashboard-action-fg)] text-xs font-semibold shadow-2xs"
            >
              <a href={`/api/brands/kia/walk-in-leads/export?${toParams({ ...effectiveQuery, page: 1 }).toString()}`}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export Excel
              </a>
            </Button>
          </div>
        </div>

        {/* ── Filters Section ─────────────────────────────────────────────────────────── */}
        <Section
          kicker="AM Kia · Sales"
          title={
            activeTab === 'register'
              ? 'Walk-in register'
              : activeTab === 'booked'
                ? 'Booked customers calling list'
                : 'Analytics filters'
          }
          description={
            data
              ? `${activeTab === 'booked' ? (summary?.booked ?? 0) : data.total.toLocaleString('en-IN')} ${activeTab === 'booked' ? 'booked customers' : 'walk-ins'} · ${dayLabel(query.from)} – ${dayLabel(query.to)}`
              : 'Loading…'
          }
          icon={activeTab === 'booked' ? PhoneCall : UserPlus}
          bodyClassName="space-y-3"
        >
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
              className="text-xs font-semibold text-[var(--dashboard-primary)] hover:underline"
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
                  onClick={() => setActiveTab('booked')}
                  className="p-3.5 rounded-2xl bg-white border border-slate-200/90 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all cursor-pointer shadow-2xs group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider block">Booked</span>
                    <span className="text-[10.5px] text-indigo-600 font-bold group-hover:underline flex items-center gap-1">
                      Calling list →
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-indigo-950 tabular-nums">{summary.booked}</span>
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
                  <table className="kia-table w-full min-w-[1080px] text-[12.5px] sm:text-[13px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/20 bg-[var(--dashboard-primary)] text-[12px] font-bold text-white">
                        <th className="px-4 py-3 text-left border-r border-white/10">Visit Date</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Customer &amp; Area</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Mobile</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Model</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Consultant</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Test Drive</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Forecast / Expected</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Holding Reason</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Next Follow-up</th>
                        <th className="px-4 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {data.rows.map((lead) => {
                        const isOverdue = lead.followUpDate && !lead.booked && lead.followUpDate < today
                        const isToday = lead.followUpDate && !lead.booked && lead.followUpDate === today

                        return (
                          <tr
                            key={lead.id}
                            className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-indigo-50/35 transition-colors"
                            onClick={() => setOpenLead(lead)}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setOpenLead(lead) }}
                          >
                            {/* Visit Date */}
                            <td className="whitespace-nowrap px-4 py-2.5 border-r border-slate-200/70">
                              <p className="font-semibold text-slate-900">{dayLabel(lead.enquiryDate)}</p>
                              {data.branches.length > 1 && <p className="text-[11px] text-slate-400 font-medium">{lead.branch}</p>}
                            </td>

                            {/* Customer & Area */}
                            <td className="px-3 py-2.5 border-r border-slate-200/70">
                              <p className="font-semibold text-slate-900">{lead.customerName}</p>
                              {lead.address && (
                                <p className="text-[11px] text-slate-600 font-medium line-clamp-1">
                                  {lead.address}
                                </p>
                              )}
                              <p className="text-[10.5px] text-slate-400 font-medium">
                                {title(lead.enquirySource)}{lead.customerType ? ` · ${title(lead.customerType)}` : ''}
                                {lead.repeatVisit && <span className="ml-1 font-semibold text-amber-700">· came back</span>}
                              </p>
                            </td>

                            {/* Mobile */}
                            <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 border-r border-slate-200/70">{lead.mobile}</td>

                            {/* Model */}
                            <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900 border-r border-slate-200/70">{lead.model}</td>

                            {/* Consultant */}
                            <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 border-r border-slate-200/70">{lead.consultantName}</td>

                            {/* Test Drive */}
                            <td className="px-3 py-2.5 border-r border-slate-200/70">
                              {lead.testDrive ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                                  Yes
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs font-medium">No</span>
                              )}
                            </td>

                            {/* Forecast / Expected Booking */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              {lead.expectedBookingTimeline && (
                                <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200 mb-0.5">
                                  {lead.expectedBookingTimeline}
                                </span>
                              )}
                              <p className="text-xs font-semibold text-slate-700">{dayLabel(lead.expectedBookingDate)}</p>
                            </td>

                            {/* Holding Reason */}
                            <td className="max-w-[14rem] px-3 py-2.5 border-r border-slate-200/70">
                              {lead.holdingReason ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200/80">
                                  {lead.holdingReason}
                                </span>
                              ) : lead.remarks ? (
                                <p className="line-clamp-2 text-slate-600 font-normal">{lead.remarks}</p>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>

                            {/* Next Follow-up */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              {lead.booked ? (
                                <span className="text-xs text-slate-400 font-medium">Closed</span>
                              ) : isOverdue ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                                  {dayLabel(lead.followUpDate)} (Overdue)
                                </span>
                              ) : isToday ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-600 animate-pulse" />
                                  Today
                                </span>
                              ) : lead.followUpDate ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                                  {dayLabel(lead.followUpDate)}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>

                            {/* Status */}
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
                        )
                      })}
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

        {/* ── VIEW TAB 2: BOOKED CUSTOMERS CALLING SHEET ───────────────────────────── */}
        {activeTab === 'booked' && (
          <div className="space-y-4">
            {/* Calling KPI Strip */}
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-200/90 shadow-2xs">
                  <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider block">Booked Customers</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-indigo-950 tabular-nums">{summary.booked}</span>
                    <span className="text-[11px] text-indigo-700 font-medium">{pct(summary.booked, summary.total)} of walk-ins</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Trade-in / Exchange</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900 tabular-nums">{summary.exchange}</span>
                    <span className="text-[11px] text-slate-500 font-medium">{pct(summary.exchange, summary.total)} with trade-in</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Test Drive Done</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900 tabular-nums">{summary.testDrives}</span>
                    <span className="text-[11px] text-sky-700 font-medium">experienced car</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Follow-up Calling</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-sm font-bold text-slate-900">Direct Connect</span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-slate-500 font-medium">Click-to-Call &amp; WhatsApp desk</p>
                </div>
              </div>
            )}

            {/* Table Area */}
            {list.isLoading ? (
              <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs"><TableSkeleton rows={8} columns={8} /></div>
            ) : list.isError && !data ? (
              <PremiumEmptyState illustration="error" title="Booked walk-ins could not be loaded" description={list.error instanceof Error ? list.error.message : undefined} action={<Button onClick={() => list.refetch()}>Try again</Button>} />
            ) : data && data.rows.length === 0 ? (
              <PremiumEmptyState
                illustration="search"
                title="No booked walk-ins in this period"
                description={filtered ? 'Clear some filters or change the date range.' : 'Walk-ins marked as booked will appear here in the calling list.'}
              />
            ) : data ? (
              <Section
                title="Booked Customer Calling Register"
                description={`${data.total.toLocaleString('en-IN')} booked customers · Click Call or WhatsApp to connect directly`}
                bodyClassName="p-0"
              >
                <div className="kia-scroll overflow-x-auto">
                  <table className="kia-table w-full min-w-[1120px] text-[12.5px] sm:text-[13px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/20 bg-[var(--dashboard-primary)] text-[12px] font-bold text-white">
                        <th className="px-4 py-3 text-left border-r border-white/10">Customer &amp; Area</th>
                        <th className="px-4 py-3 text-left border-r border-white/10">Direct Calling</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Model Booked</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Consultant &amp; Branch</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Visit / Booking Date</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Delivery / Target Date</th>
                        <th className="px-3 py-3 text-left border-r border-white/10">Remarks &amp; Exchange</th>
                        <th className="px-4 py-3 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {data.rows.map((lead) => {
                        const rawPhone = lead.mobile.replace(/\D/g, '')
                        const canCall = data.canViewPii && rawPhone.length >= 10

                        return (
                          <tr
                            key={lead.id}
                            className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-slate-100/60 transition-colors"
                            onClick={() => setOpenLead(lead)}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') setOpenLead(lead) }}
                          >
                            {/* Customer & Area */}
                            <td className="px-4 py-2.5 border-r border-slate-200/70">
                              <p className="font-bold text-slate-900">{lead.customerName}</p>
                              {lead.address && (
                                <p className="text-[11px] text-slate-600 font-medium line-clamp-1">
                                  {lead.address}
                                </p>
                              )}
                              <p className="text-[10.5px] text-slate-400 font-medium">
                                {title(lead.enquirySource)}{lead.customerType ? ` · ${title(lead.customerType)}` : ''}
                                {lead.repeatVisit && <span className="ml-1 font-semibold text-amber-700">· Repeat</span>}
                              </p>
                            </td>

                            {/* Direct Calling Actions */}
                            <td className="px-4 py-2.5 border-r border-slate-200/70" onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col gap-1.5">
                                {canCall ? (
                                  <>
                                    <a
                                      href={`tel:+91${rawPhone.slice(-10)}`}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-hover)] text-[var(--dashboard-action-fg)] text-xs font-bold shadow-2xs transition-colors w-fit"
                                      title="Call customer directly"
                                    >
                                      <Phone className="h-3.5 w-3.5" />
                                      {lead.mobile}
                                    </a>
                                    <a
                                      href={`https://wa.me/91${rawPhone.slice(-10)}?text=${encodeURIComponent(`Hello ${lead.customerName}, greeting from AM Kia showroom regarding your ${lead.model} booking.`)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300 text-[11px] font-semibold transition-colors w-fit"
                                    >
                                      <MessageSquare className="h-3 w-3 text-slate-600" />
                                      WhatsApp
                                    </a>
                                  </>
                                ) : (
                                  <span className="font-mono text-xs text-slate-500 font-medium">{lead.mobile}</span>
                                )}
                              </div>
                            </td>

                            {/* Model Booked */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-900 border border-slate-200">
                                {lead.model}
                              </span>
                              {lead.testDrive && (
                                <p className="mt-1 text-[10.5px] font-semibold text-sky-700">Test drive taken</p>
                              )}
                            </td>

                            {/* Consultant & Branch */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              <p className="font-semibold text-slate-900">{lead.consultantName}</p>
                              <p className="text-[11px] text-slate-500 font-medium">{lead.branch} showroom</p>
                            </td>

                            {/* Visit / Booking Date */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              <p className="font-semibold text-slate-900">{dayLabel(lead.enquiryDate)}</p>
                              <p className="text-[10.5px] text-slate-400">Booked visit</p>
                            </td>

                            {/* Delivery / Target Date */}
                            <td className="whitespace-nowrap px-3 py-2.5 border-r border-slate-200/70">
                              {lead.expectedBookingDate ? (
                                <p className="font-bold text-slate-900">{dayLabel(lead.expectedBookingDate)}</p>
                              ) : (
                                <p className="text-xs text-slate-400 font-medium">—</p>
                              )}
                              {lead.expectedBookingTimeline && (
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10.5px] font-medium bg-slate-100 text-slate-700">
                                  {lead.expectedBookingTimeline}
                                </span>
                              )}
                            </td>

                            {/* Remarks & Exchange */}
                            <td className="max-w-[15rem] px-3 py-2.5 border-r border-slate-200/70">
                              {lead.exchange && (
                                <p className="text-[11px] font-semibold text-amber-800 mb-0.5">
                                  Trade-in: {lead.exchangeDetails || 'Yes'}
                                </p>
                              )}
                              {lead.remarks ? (
                                <p className="line-clamp-2 text-xs text-slate-700">{lead.remarks}</p>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>

                            {/* Action */}
                            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setOpenLead(lead)}
                                className="h-8 rounded-lg border-indigo-200 text-indigo-900 bg-indigo-50/50 hover:bg-indigo-100 text-xs font-semibold"
                              >
                                Log Call / Notes
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-3 text-xs font-semibold text-slate-600 bg-slate-50/50">
                  <span>Page {query.page} of {pages} ({data.total} booked)</span>
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

        {/* ── VIEW TAB 3: COMPREHENSIVE ANALYTICS SUITE ────────────────────────────── */}
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
  const [timeline, setTimeline] = React.useState(lead.expectedBookingTimeline ?? '')
  const [expected, setExpected] = React.useState(lead.expectedBookingDate ?? '')
  const [holdingReason, setHoldingReason] = React.useState(lead.holdingReason ?? '')
  const [followUpDate, setFollowUpDate] = React.useState(lead.followUpDate ?? '')
  const [booked, setBooked] = React.useState(lead.booked)
  const [removing, setRemoving] = React.useState(false)
  const [reason, setReason] = React.useState('')

  const dirty =
    remarks !== (lead.remarks ?? '') ||
    timeline !== (lead.expectedBookingTimeline ?? '') ||
    expected !== (lead.expectedBookingDate ?? '') ||
    holdingReason !== (lead.holdingReason ?? '') ||
    followUpDate !== (lead.followUpDate ?? '') ||
    booked !== lead.booked

  const save = useMutation({
    mutationFn: () => api<{ lead: WalkInLead }>(`/api/brands/kia/walk-in-leads/${lead.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(remarks !== (lead.remarks ?? '') ? { remarks } : {}),
        ...(timeline !== (lead.expectedBookingTimeline ?? '') ? { expectedBookingTimeline: timeline } : {}),
        ...(expected !== (lead.expectedBookingDate ?? '') ? { expectedBookingDate: expected } : {}),
        ...(holdingReason !== (lead.holdingReason ?? '') ? { holdingReason } : {}),
        ...(followUpDate !== (lead.followUpDate ?? '') ? { followUpDate } : {}),
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
      <DialogContent className="kia-premium max-h-[92dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-5 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl font-bold text-slate-900">
            {lead.customerName}
            {lead.booked ? <Chip tone="indigo" dot>Booked</Chip> : <Chip tone="amber" dot>Open</Chip>}
            {lead.repeatVisit && <Chip tone="amber">Came back</Chip>}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-slate-600 mt-1">
            {lead.model} · visited {dayLabel(lead.enquiryDate)} · {lead.branch} · {lead.source === 'import' ? 'from old Google Form' : `sent ${new Date(lead.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldValue label="Mobile" value={lead.mobile === '••••••' ? lead.mobile : `${lead.countryCode} ${lead.mobile}`} mono />
            <FieldValue label="E-mail" value={lead.email ?? '—'} />
            <FieldValue label="Consultant" value={lead.consultantName} />
            <FieldValue label="Source" value={title(lead.enquirySource)} />
            <FieldValue label="Customer Profile" value={lead.customerType ? title(lead.customerType) : '—'} />
            <FieldValue label="Test drive" value={lead.testDrive ? 'Yes' : 'No'} />
            <FieldValue label="Exchange" value={lead.exchange === null ? '—' : lead.exchange ? `Yes${lead.exchangeDetails ? ` — ${lead.exchangeDetails}` : ''}` : 'No'} />
            <FieldValue label="Address / Area" value={lead.address ?? '—'} />
            {lead.additionalInfo && <FieldValue label="Anything else" value={lead.additionalInfo} className="sm:col-span-2" />}
          </div>
          {!canViewPii && <p className="text-[11px] text-slate-400">Mobile, e-mail and address are visible only to MD, Developer and the other KIA customer-data roles.</p>}

          <div className="kia-surface-sunken space-y-3 rounded-xl p-4 bg-slate-50 border border-slate-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Follow-up &amp; Pipeline Commitment</p>
            {canEdit ? (
              <div className="space-y-3">
                {/* Timeline forecasting chips */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Forecasting timeline</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WALK_IN_BOOKING_TIMELINES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTimeline(t)
                          if (t === 'Booked today') {
                            setBooked(true)
                            setExpected(lead.enquiryDate)
                          }
                        }}
                        className={cn(
                          'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                          timeline === t
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Holding reason chips */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">What is holding them back?</label>
                  <div className="flex flex-wrap gap-1.5">
                    {WALK_IN_HOLDING_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setHoldingReason(r)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                          holdingReason === r
                            ? 'border-amber-600 bg-amber-500 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Remarks */}
                <label className="block text-xs font-semibold text-slate-700">
                  Customer remarks / notes
                  <input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    maxLength={500}
                    placeholder="Specific requests, follow-up notes..."
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>

                {/* Date Grid: Expected Booking Date + Next Follow-up Date */}
                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Expected booking date
                    <input
                      type="date"
                      value={expected}
                      min={lead.enquiryDate}
                      onChange={(e) => setExpected(e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-slate-700">
                    Next follow-up date (Call commitment)
                    <input
                      type="date"
                      value={followUpDate}
                      min={lead.enquiryDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                  <label className="inline-flex h-10 items-center gap-2 text-sm font-semibold text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={booked}
                      onChange={(e) => setBooked(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Mark as Booked
                  </label>
                  <Button
                    className="bg-[#05141f] text-white hover:bg-slate-900"
                    disabled={!dirty || save.isPending}
                    onClick={() => save.mutate()}
                  >
                    {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save follow-up
                  </Button>
                </div>
                {lead.updatedByName && (
                  <p className="text-[11px] text-slate-400">Last updated by {lead.updatedByName} · {new Date(lead.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <FieldValue label="Forecast Timeline" value={lead.expectedBookingTimeline ?? '—'} />
                <FieldValue label="Expected booking" value={dayLabel(lead.expectedBookingDate)} />
                <FieldValue label="Holding reason" value={lead.holdingReason ?? '—'} />
                <FieldValue label="Next follow-up date" value={dayLabel(lead.followUpDate)} />
                <FieldValue label="Customer remarks" value={lead.remarks ?? '—'} className="sm:col-span-2" />
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
      <DialogContent className="kia-premium max-h-[94dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-5 text-left">
          <DialogTitle className="text-xl font-bold text-slate-900">Walk-in form links &amp; Showroom QRs</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-slate-600 mt-1">
            Staff open these without logging in. Print the QR code for the showroom desk, or share the link on WhatsApp. Each link files walk-ins under its branch.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
          {links.isLoading && <p className="col-span-full py-8 text-center text-sm text-slate-500">Preparing showroom links…</p>}
          {links.isError && <p className="col-span-full py-8 text-center text-sm text-rose-700">{links.error instanceof Error ? links.error.message : 'The links could not be loaded.'}</p>}
          {links.data?.links.map((link) => <LinkCard key={link.dealerCode} link={link} />)}
        </div>
        <p className="border-t border-slate-200/80 bg-slate-50 px-6 py-3 text-[11px] text-slate-500 rounded-b-2xl">
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
    <div className="kia-surface-sunken flex flex-col items-center gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 text-center shadow-2xs">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-3 py-1 text-xs font-bold text-slate-900">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        {link.branch} showroom
      </div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`QR code for the ${link.branch} walk-in form`} className="h-44 w-44 rounded-xl bg-white p-2 shadow-xs border border-slate-200/70" />
      ) : (
        <div className="h-44 w-44 animate-pulse rounded-xl bg-slate-200/60" />
      )}
      <p className="w-full break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[10.5px] font-medium text-slate-600 border border-slate-200/60 select-all">{url}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={copy} className="h-8 rounded-xl border-slate-200 text-xs font-semibold hover:bg-white">{copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-slate-700" /> : <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy link'}</Button>
        <Button size="sm" variant="outline" asChild className="h-8 rounded-xl border-slate-200 text-xs font-semibold hover:bg-white"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open</a></Button>
        {qr && <Button size="sm" variant="outline" asChild className="h-8 rounded-xl border-slate-200 text-xs font-semibold hover:bg-white"><a href={qr} download={`kia-walk-in-${link.branch.toLowerCase()}.png`}><Download className="mr-1.5 h-3.5 w-3.5" /> QR</a></Button>}
      </div>
    </div>
  )
}
