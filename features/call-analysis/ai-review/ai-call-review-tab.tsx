'use client'

/**
 * AI Call Review — the MD's inbox of calls. Every AM Hyundai recording is transcribed and read by AI; this tab
 * shows what needs him first (complaints, unhappy customers, promises falling due), then hot leads, then the
 * rest. A row opens the review, with the moments that matter one click from the audio.
 */
import React, { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Flame, Loader2, PauseCircle, PhoneIncoming, PhoneOutgoing, PlayCircle,
  Search, Sparkles, X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  INTENT_LABELS,
  MOOD_LABELS,
  VERDICT_LABELS,
  VERDICTS,
  type Intent,
  type PipelineStatus,
  type ReviewListResponse,
  type ReviewQueue,
  type ReviewRow,
  type Verdict,
} from '@/lib/call-ai/types'
import { callTime, clock, dueLabel, effectiveVerdict, fetchJson, MOOD_TONE, PendingChip, VerdictChip } from './ai-shared'
import { AiReviewDrawer } from './ai-review-drawer'

type Props = {
  startDate: string
  endDate: string
  agent: string
}

const QUEUES: Array<{ key: ReviewQueue; label: string; help: string }> = [
  { key: 'attention', label: 'Needs attention', help: 'Complaints, unhappy customers, promises due today or overdue, and calls the AI could not judge' },
  { key: 'hot', label: 'Hot leads', help: 'Buyers ready to act soon' },
  { key: 'followups', label: 'Promises', help: 'Everything the dealership promised to do, by due date' },
  { key: 'all', label: 'All calls', help: 'Every reviewed customer call' },
  { key: 'not_customer', label: 'Not customer calls', help: 'Staff, personal, wrong-number, ringing, too short' },
]

function Tile({ label, value, sub, tone, active, onClick }: { label: string; value: React.ReactNode; sub?: string; tone: string; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex flex-col rounded-2xl border bg-white p-4 text-left shadow-xs transition',
        onClick && 'cursor-pointer hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40',
        active ? 'border-[#093339] ring-1 ring-[#093339]/20' : 'border-slate-200/80',
      )}
    >
      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>
      <span className={cn('mt-1.5 text-2xl font-black tracking-tight tabular-nums', tone)}>{value}</span>
      {sub && <span className="mt-1 text-[10px] font-bold text-slate-400">{sub}</span>}
    </Tag>
  )
}

function Row({ row, today, onOpen }: { row: ReviewRow; today: string; onOpen: () => void }) {
  const verdict = effectiveVerdict(row)
  const due = row.status === 'done' ? dueLabel(row.followUpDue, today) : null
  const who = row.customer?.name || row.customer?.notACustomer || row.customer?.phone || 'Unknown caller'
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-1 gap-2 px-4 py-3.5 text-left transition hover:bg-slate-50/80 focus:outline-none focus-visible:bg-teal-50/40 sm:grid-cols-[132px_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
      >
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 sm:flex-col sm:items-start sm:gap-0.5">
          <span className="text-slate-800">{callTime(row.recordedAt)}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            {row.callType === 'incoming' ? <PhoneIncoming className="h-3 w-3 text-green-600" /> : <PhoneOutgoing className="h-3 w-3 text-[#093339]" />}
            {clock(row.durationSeconds)}
          </span>
        </div>
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-black text-slate-900">{who}</span>
            {row.customer?.name && row.customer.phone && <span className="font-semibold tabular-nums text-slate-400">{row.customer.phone}</span>}
            <span className="font-semibold text-slate-400">· {[row.creName, row.team].filter(Boolean).join(' · ')}</span>
          </p>
          {row.headline ? (
            <p className="truncate text-sm font-bold text-slate-800">{row.headline}</p>
          ) : null}
          {row.customerWanted && <p className="line-clamp-1 text-xs text-slate-500">{row.customerWanted}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          {row.status === 'done' && verdict ? <VerdictChip verdict={verdict} corrected={Boolean(row.overrideVerdict)} /> : <PendingChip row={row} />}
          {row.mood && row.status === 'done' && verdict !== 'not_customer' && (
            <span className={cn('text-[10px] font-bold', MOOD_TONE[row.mood])}>{MOOD_LABELS[row.mood]}</span>
          )}
          {due && <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', due.tone)}>{due.text}</span>}
        </div>
      </button>
    </li>
  )
}

function PipelineStrip({ status }: { status: PipelineStatus }) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => fetchJson<PipelineStatus>('/api/call-analysis/ai/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-ai-status'] }),
  })
  const run = useMutation({
    mutationFn: () => fetchJson<Record<string, unknown>>('/api/call-analysis/ai/run', { method: 'POST' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['call-ai-status'] })
      void queryClient.invalidateQueries({ queryKey: ['call-ai-reviews'] })
    },
  })
  const paused = !status.enabled || !status.envEnabled
  const lastRun = status.lastRunAt ? callTime(status.lastRunAt) : 'never'
  const accuracy = status.accuracy.rated ? `${Math.round((status.accuracy.correct / status.accuracy.rated) * 100)}% right (${status.accuracy.rated} rated)` : 'no ratings yet'
  const limited = status.rateLimitedUntil && new Date(status.rateLimitedUntil) > new Date()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-2.5 text-[11px] font-semibold text-slate-500">
      <span className={cn('inline-flex items-center gap-1.5 font-black', paused ? 'text-amber-700' : limited ? 'text-orange-700' : 'text-[#093339]')}>
        <span className={cn('h-2 w-2 rounded-full', paused ? 'bg-amber-500' : limited ? 'bg-orange-500' : 'bg-green-500')} />
        {paused ? (status.envEnabled ? 'AI review paused' : 'AI review switched off (CALL_AI_ENABLED)') : limited ? 'Waiting on the AI provider\'s rate limit' : 'AI review running'}
      </span>
      <span>Last run {lastRun}</span>
      <span>{status.counts.queued + status.counts.processing} waiting</span>
      {status.counts.failed > 0 && <span className="text-rose-600">{status.counts.failed} failed</span>}
      <span>Today ${status.costTodayUsd.toFixed(2)} · this month ${status.costMonthUsd.toFixed(2)}</span>
      <span>Accuracy: {accuracy}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <button type="button" disabled={run.isPending || paused} onClick={() => run.mutate()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Run now
        </button>
        {status.envEnabled && (
          <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate(!status.enabled)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">
            {status.enabled ? <><PauseCircle className="h-3.5 w-3.5" /> Pause</> : <><PlayCircle className="h-3.5 w-3.5" /> Resume</>}
          </button>
        )}
      </span>
      {status.recentErrors[0] && (
        <span className="w-full truncate text-[10px] text-slate-400" title={status.recentErrors[0].error}>Last error: {status.recentErrors[0].error}</span>
      )}
    </div>
  )
}

export function AiCallReviewTab({ startDate, endDate, agent }: Props) {
  const [queue, setQueue] = useState<ReviewQueue>('attention')
  const [verdict, setVerdict] = useState<Verdict | ''>('')
  const [intent, setIntent] = useState<Intent | ''>('')
  const [team, setTeam] = useState('')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const params = useMemo(() => {
    const p = new URLSearchParams({ queue, page: String(page), pageSize: '25' })
    if (startDate) p.set('from', startDate)
    if (endDate) p.set('to', endDate)
    if (agent && agent !== 'all') p.set('agent', agent)
    if (verdict) p.set('verdict', verdict)
    if (intent) p.set('intent', intent)
    if (team) p.set('team', team)
    if (q) p.set('q', q)
    return p.toString()
  }, [queue, page, startDate, endDate, agent, verdict, intent, team, q])

  const list = useQuery<ReviewListResponse>({
    queryKey: ['call-ai-reviews', params],
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: () => fetchJson<ReviewListResponse>(`/api/call-analysis/ai/reviews?${params}`),
  })
  // 403 for everyone but the MD and developers — the strip simply does not render for them.
  const status = useQuery<PipelineStatus>({
    queryKey: ['call-ai-status'],
    staleTime: 60 * 1000,
    retry: false,
    queryFn: () => fetchJson<PipelineStatus>('/api/call-analysis/ai/status'),
  })
  const isAdmin = status.isSuccess

  const data = list.data
  const d = data?.digest
  const today = data?.today ?? new Date().toISOString().slice(0, 10)
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const pick = (next: { queue?: ReviewQueue; verdict?: Verdict | ''; intent?: Intent | '' }) => {
    if (next.queue) setQueue(next.queue)
    if (next.verdict !== undefined) setVerdict(next.verdict)
    if (next.intent !== undefined) setIntent(next.intent)
    setPage(1)
  }
  const filtersOn = Boolean(verdict || intent || team || q)
  const maxIntent = Math.max(1, ...(d?.byIntent.map((i) => i.count) ?? [1]))

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black tracking-tight text-slate-900">
            <Sparkles className="h-4 w-4 text-[#093339]" /> AI Call Review
          </h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            Every AM Hyundai call recording, transcribed and read by AI — so you only listen to the ones that need you.
          </p>
        </div>
        {d && (
          <p className="text-[11px] font-bold text-slate-400">
            {d.reviewed} of {d.inScope} calls reviewed{d.pending ? ` · ${d.pending} in progress` : ''}{d.noConversation ? ` · ${d.noConversation} not a conversation` : ''}
          </p>
        )}
      </div>

      {isAdmin && status.data && <PipelineStrip status={status.data} />}

      {/* Digest */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Needs attention" value={d?.needsAttention ?? '—'} tone="text-rose-700" active={queue === 'attention' && !verdict} onClick={() => pick({ queue: 'attention', verdict: '', intent: '' })} />
        <Tile label="Complaints" value={d?.complaints ?? '—'} tone="text-rose-700" active={verdict === 'complaint'} onClick={() => pick({ queue: 'all', verdict: 'complaint', intent: '' })} />
        <Tile label="Unhappy" value={d?.unhappy ?? '—'} tone="text-orange-700" active={verdict === 'unhappy'} onClick={() => pick({ queue: 'all', verdict: 'unhappy', intent: '' })} />
        <Tile label="Hot leads" value={d?.hotLeads ?? '—'} tone="text-emerald-700" active={queue === 'hot'} onClick={() => pick({ queue: 'hot', verdict: '', intent: '' })} />
        <Tile label="Promises due today" value={d?.followUpsDueToday ?? '—'} sub={d?.followUpsOverdue ? `${d.followUpsOverdue} overdue this week` : undefined} tone="text-indigo-700" active={queue === 'followups'} onClick={() => pick({ queue: 'followups', verdict: '', intent: '' })} />
        <Tile label="Reviewed" value={d ? d.reviewed : '—'} sub={d ? `of ${d.inScope} recordings` : undefined} tone="text-slate-900" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 shadow-sm">
          {/* Queues + filters */}
          <div className="space-y-3 border-b border-slate-100 px-4 pb-3 pt-4">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Which calls">
              {QUEUES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={queue === item.key}
                  title={item.help}
                  onClick={() => pick({ queue: item.key })}
                  className={cn('rounded-xl px-3 py-1.5 text-xs font-black transition', queue === item.key ? 'bg-[#093339] text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}
                >
                  {item.key === 'hot' && <Flame className="mr-1 inline h-3 w-3" />}
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form className="relative min-w-[200px] flex-1" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setPage(1) }}>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Search what was said — refund, delivery late, Creta…"
                  aria-label="Search the AI summaries"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40"
                />
              </form>
              <select value={verdict} onChange={(e) => { setVerdict(e.target.value as Verdict | ''); setPage(1) }} aria-label="Verdict"
                className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40">
                <option value="">Any verdict</option>
                {VERDICTS.map((v) => <option key={v} value={v}>{VERDICT_LABELS[v]}</option>)}
              </select>
              {(data?.teams.length ?? 0) > 1 && (
                <select value={team} onChange={(e) => { setTeam(e.target.value); setPage(1) }} aria-label="Desk"
                  className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40">
                  <option value="">All desks</option>
                  {data!.teams.map((t) => <option key={t.label} value={t.label}>{t.label.replace(/^Special Branch \((.+)\)$/, '$1 desk')} ({t.count})</option>)}
                </select>
              )}
              {filtersOn && (
                <button type="button" onClick={() => { setVerdict(''); setIntent(''); setTeam(''); setQ(''); setDraft(''); setPage(1) }}
                  className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          {/* The list */}
          {list.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-[#093339]" /> Loading reviewed calls…
            </div>
          ) : list.isError ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-rose-600">
              <AlertTriangle className="h-4 w-4" /> {list.error instanceof Error ? list.error.message : 'Could not load the review.'}
            </div>
          ) : data && data.rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-black text-slate-600">
                {queue === 'attention' && !filtersOn ? 'Nothing needs your attention in these dates.' : 'No calls match.'}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400">
                {d && d.inScope === 0 ? 'No AM Hyundai recordings have been reviewed for these dates yet — new calls are picked up every 10 minutes.' : 'Try another tab, widen the dates, or clear the filters.'}
              </p>
            </div>
          ) : (
            <ul className={cn('divide-y divide-slate-100', list.isFetching && 'opacity-70')}>
              {data?.rows.map((row) => <Row key={row.id} row={row} today={today} onOpen={() => setOpenId(row.id)} />)}
            </ul>
          )}

          {data && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <p className="text-xs font-bold text-slate-500">Page {data.page} of {totalPages} · {data.total} calls</p>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 disabled:opacity-40">
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                  className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 disabled:opacity-40">
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Why customers called */}
        <Card className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Why customers called</h3>
          {d && d.byIntent.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {d.byIntent.slice(0, 8).map((item) => (
                <li key={item.intent}>
                  <button type="button" onClick={() => pick({ queue: 'all', intent: intent === item.intent ? '' : item.intent })}
                    className={cn('w-full rounded-lg px-1.5 py-1 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40', intent === item.intent && 'bg-teal-50')}>
                    <span className="flex items-baseline justify-between gap-2 text-xs font-bold text-slate-700">
                      <span className="truncate">{INTENT_LABELS[item.intent] ?? item.intent}</span>
                      <span className="tabular-nums text-slate-400">{item.count}</span>
                    </span>
                    <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                      <span className="block h-1.5 rounded-full bg-[#093339]" style={{ width: `${Math.max(4, (item.count / maxIntent) * 100)}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs font-medium text-slate-400">Appears once calls are reviewed.</p>
          )}
          <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] font-medium leading-relaxed text-slate-400">
            AI verdicts can be wrong. Open a call to hear the moment that decided it, and mark a wrong verdict — your correction replaces it.
          </p>
        </Card>
      </div>

      <AiReviewDrawer reviewId={openId} onClose={() => setOpenId(null)} isAdmin={isAdmin} today={today} />
    </div>
  )
}
