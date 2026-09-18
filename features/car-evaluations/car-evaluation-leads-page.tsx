'use client'

import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarCheck, CalendarClock, Car, ClipboardCopy, Link2, Search, Users } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Chip, KpiRow, PremiumEmptyState, Section, TableSkeleton } from '@/components/kia/premium'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { addDays, formatDay, formatKm } from '@/lib/evaluation/catalog'
import type { EvaluationLead, LeadPeriod, LeadsResult } from '@/lib/evaluation/read'

/*
 * Car Evaluation Leads — who asked for a free evaluation on /sell-used-car, newest first.
 * Read-only. Filters live in component state (not the URL): in Next 16 a userland replaceState with a URL
 * costs a server round trip, and nothing here needs a shareable filter link.
 */

const PERIODS: Array<{ value: LeadPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All time' },
]
const NO_CAMPAIGN = '__none'

const receivedFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function reference(id: string) {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

function spaced(mobile: string) {
  return mobile.length === 10 ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

async function fetchLeads(params: { period: LeadPeriod; campaign: string; q: string; page: number }): Promise<LeadsResult> {
  const search = new URLSearchParams({ period: params.period, page: String(params.page) })
  if (params.campaign) search.set('campaign', params.campaign)
  if (params.q) search.set('q', params.q)
  const response = await fetch(`/api/car-evaluations?${search.toString()}`, { cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || 'Could not load the leads.')
  return body as LeadsResult
}

export function CarEvaluationLeadsPage() {
  const [period, setPeriod] = React.useState<LeadPeriod>('month')
  const [campaign, setCampaign] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const q = useDebounced(search.trim(), 300)

  const list = useQuery({
    queryKey: ['car-evaluations', period, campaign, q, page],
    queryFn: () => fetchLeads({ period, campaign, q, page }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = list.data

  const changeFilter = (apply: () => void) => {
    apply()
    setPage(1)
  }

  const firstRow = data ? (data.page - 1) * data.pageSize + 1 : 0
  const lastRow = data ? Math.min(data.page * data.pageSize, data.total) : 0

  return (
    <MainLayout title="Car Evaluation Leads" subtitle="Owners who asked for a free evaluation on the sell-your-car page">
      <div className="kia-premium space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-2xs">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100/90 p-1" role="group" aria-label="Period">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={period === option.value}
                onClick={() => changeFilter(() => setPeriod(option.value))}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  period === option.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            Campaign
            <select
              value={campaign}
              onChange={(event) => changeFilter(() => setCampaign(event.target.value))}
              className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800"
            >
              <option value="">All campaigns</option>
              {(data?.campaigns ?? []).map((item) => (
                <option key={item.campaign} value={item.campaign}>
                  {item.campaign === NO_CAMPAIGN ? 'No campaign tag' : item.campaign} ({item.leads})
                </option>
              ))}
            </select>
          </label>
          <label className="relative ml-auto flex min-w-[220px] flex-1 items-center sm:max-w-xs">
            <span className="sr-only">Search leads</span>
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
              placeholder="Name, mobile, model or reference"
              className="h-8.5 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs font-medium text-slate-800 placeholder:text-slate-400"
            />
          </label>
        </div>

        <KpiRow
          items={[
            { key: 'leads', label: 'Leads', value: data?.kpis.leads ?? 0, icon: Users, tone: 'accent', hint: PERIODS.find((p) => p.value === period)?.label },
            { key: 'new', label: 'Also want a new car', value: data?.kpis.wantsNewCar ?? 0, icon: Car, tone: 'success', hint: 'Exchange interest' },
            { key: 'today', label: 'Evaluation day today', value: data?.kpis.dueToday ?? 0, icon: CalendarCheck, tone: 'warning', hint: 'All leads' },
            { key: 'week', label: 'In the next 7 days', value: data?.kpis.dueNextWeek ?? 0, icon: CalendarClock, tone: 'neutral', hint: 'All leads' },
          ]}
        />

        {list.isError ? (
          <div className="rounded-2xl border border-rose-200 bg-white p-5 text-sm font-medium text-rose-700">
            {list.error instanceof Error ? list.error.message : 'Could not load the leads.'}{' '}
            <button type="button" className="font-semibold underline" onClick={() => list.refetch()}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
            <TableSkeleton rows={8} columns={7} />
          </div>
        ) : data.rows.length === 0 ? (
          <PremiumEmptyState
            title={q ? 'No leads match that search' : 'No leads in this period'}
            description={
              q
                ? 'Try a name, the last digits of a mobile number, a model, or the six-character reference.'
                : 'Share the form link below. Each request appears here the moment it is sent, and emails the desk.'
            }
          />
        ) : (
          <Section
            title="Leads"
            description={`Newest first · ${firstRow.toLocaleString('en-IN')}–${lastRow.toLocaleString('en-IN')} of ${data.total.toLocaleString('en-IN')}${list.isFetching ? ' · updating…' : ''}`}
            bodyClassName="p-0"
          >
            <div className="kia-scroll overflow-x-auto">
              <table className="kia-table w-full min-w-[1000px] border-collapse text-[12.5px] sm:text-[13px]">
                <thead>
                  <tr className="border-b border-white/20 bg-[var(--dashboard-primary)] text-[12px] font-bold text-white">
                    <th scope="col" className="border-r border-white/10 px-4 py-3 text-left">Received</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-left">Customer</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-left">Mobile</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-left">Car</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-right">Kilometres</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-left">Day wanted</th>
                    <th scope="col" className="border-r border-white/10 px-3 py-3 text-left">New car?</th>
                    <th scope="col" className="px-4 py-3 text-left">Campaign</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {data.rows.map((lead) => (
                    <LeadRow key={lead.id} lead={lead} today={data.today} />
                  ))}
                </tbody>
              </table>
            </div>
            {data.total > data.pageSize ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-3 text-xs font-medium text-slate-600">
                <span>
                  Page {data.page} of {Math.ceil(data.total / data.pageSize)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8 rounded-xl text-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-xs"
                    disabled={data.page * data.pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Section>
        )}

        <ShareFormLink />
      </div>
    </MainLayout>
  )
}

function LeadRow({ lead, today }: { lead: EvaluationLead; today: string }) {
  const day = lead.evaluationDate
  const dayTone = !day ? null : day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : day < today ? 'past' : 'later'
  return (
    <tr className="odd:bg-white even:bg-slate-50/60">
      <td className="whitespace-nowrap border-r border-slate-200/70 px-4 py-2.5 font-semibold text-slate-900">
        {receivedFormat.format(new Date(lead.createdAt))}
      </td>
      <td className="border-r border-slate-200/70 px-3 py-2.5">
        <p className="font-semibold text-slate-900">{lead.customerName}</p>
        <p className="text-[11px] font-medium text-slate-500">Ref {reference(lead.id)}</p>
        {lead.notes ? <p className="mt-0.5 text-[11px] font-medium text-amber-700">{lead.notes}</p> : null}
      </td>
      <td className="whitespace-nowrap border-r border-slate-200/70 px-3 py-2.5">
        <a href={`tel:+91${lead.mobile}`} className="font-semibold text-slate-900 underline-offset-2 hover:underline">
          +91 {spaced(lead.mobile)}
        </a>
        <a
          href={`https://wa.me/91${lead.mobile}`}
          target="_blank"
          rel="noreferrer"
          className="block text-[11px] font-semibold text-[var(--dashboard-primary)] underline-offset-2 hover:underline"
        >
          WhatsApp
        </a>
      </td>
      <td className="border-r border-slate-200/70 px-3 py-2.5">
        <p className="font-semibold text-slate-900">
          {lead.brand} {lead.model}
        </p>
        <p className="text-[11px] font-medium text-slate-500">{lead.manufacturingYear}</p>
      </td>
      <td className="whitespace-nowrap border-r border-slate-200/70 px-3 py-2.5 text-right tabular-nums text-slate-800">
        {lead.kilometres != null ? `${formatKm(lead.kilometres)} km` : lead.kilometresBand ?? '—'}
      </td>
      <td className="whitespace-nowrap border-r border-slate-200/70 px-3 py-2.5">
        {day ? (
          <span className="flex items-center gap-2">
            <span className={cn('font-semibold', dayTone === 'past' ? 'text-slate-400' : 'text-slate-900')}>{formatDay(day)}</span>
            {dayTone === 'today' ? <Chip tone="warning">Today</Chip> : dayTone === 'tomorrow' ? <Chip tone="neutral">Tomorrow</Chip> : null}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="border-r border-slate-200/70 px-3 py-2.5">
        {lead.interestedInNewCar ? <Chip tone="success">Yes</Chip> : <span className="text-slate-500">No</span>}
      </td>
      <td className="px-4 py-2.5">
        {lead.utmCampaign ? (
          <>
            <p className="font-semibold text-slate-900">{lead.utmCampaign}</p>
            {lead.utmSource ? <p className="text-[11px] font-medium text-slate-500">{lead.utmSource}</p> : null}
          </>
        ) : (
          <span className="text-slate-400">No tag</span>
        )}
      </td>
    </tr>
  )
}

/** Builds the link to share, tagged with a campaign name so its leads can be counted apart. */
function ShareFormLink() {
  const [name, setName] = React.useState('')
  const [origin, setOrigin] = React.useState('')
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page's own origin, known only in the browser
    setOrigin(window.location.origin)
  }, [])
  const tag = slug(name)
  const link = `${origin}/sell-used-car${tag ? `?utm_source=whatsapp&utm_campaign=${tag}` : ''}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      toast({ title: 'Link copied', description: link, variant: 'success' })
    } catch {
      toast({ title: 'Could not copy', description: 'Select the link and copy it by hand.', variant: 'error' })
    }
  }

  return (
    <Section
      title="Share the form"
      description="Name the campaign before you send the link — each lead then records which message it came from."
      icon={Link2}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Campaign name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. september-blast"
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 placeholder:text-slate-400"
          />
        </label>
        <div className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Link to share
          <code className="block overflow-x-auto whitespace-nowrap rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-800">
            {link}
          </code>
        </div>
        <Button
          type="button"
          onClick={copy}
          className="h-9 rounded-xl bg-[var(--dashboard-action-bg)] text-xs font-semibold text-[var(--dashboard-action-fg)] hover:bg-[var(--dashboard-action-hover)]"
        >
          <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Copy link
        </Button>
      </div>
    </Section>
  )
}
