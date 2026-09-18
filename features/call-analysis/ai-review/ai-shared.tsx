'use client'

/**
 * AI Call Review — small pieces shared by the tab, the drawer and the Recordings-tab chip column.
 * Tones follow the section's existing status colours (rose = trouble, emerald = opportunity/good,
 * the section's teal #093339 for the neutral accent), so the new tab reads as part of the same page.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SKIP_REASON_LABELS,
  VERDICT_HELP,
  VERDICT_LABELS,
  type Mood,
  type ReviewRow,
  type Verdict,
  type VerdictLookup,
} from '@/lib/call-ai/types'

export const VERDICT_TONE: Record<Verdict, string> = {
  complaint: 'bg-rose-50 text-rose-700 border-rose-200',
  unhappy: 'bg-orange-50 text-orange-700 border-orange-200',
  hot_lead: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  follow_up: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  service: 'bg-sky-50 text-sky-700 border-sky-200',
  enquiry: 'bg-teal-50 text-[#093339] border-teal-200',
  satisfied: 'bg-green-50 text-green-700 border-green-200',
  general: 'bg-slate-50 text-slate-600 border-slate-200',
  unclear: 'bg-white text-slate-500 border-dashed border-slate-300',
  not_customer: 'bg-slate-50 text-slate-400 border-slate-200',
}

/** The dot that sits beside a chip — the one thing the eye scans down a column. */
export const VERDICT_DOT: Record<Verdict, string> = {
  complaint: 'bg-rose-500',
  unhappy: 'bg-orange-500',
  hot_lead: 'bg-emerald-500',
  follow_up: 'bg-indigo-500',
  service: 'bg-sky-500',
  enquiry: 'bg-teal-600',
  satisfied: 'bg-green-500',
  general: 'bg-slate-400',
  unclear: 'bg-slate-300',
  not_customer: 'bg-slate-300',
}

export function effectiveVerdict(row: Pick<ReviewRow, 'verdict' | 'overrideVerdict'>): Verdict | null {
  return row.overrideVerdict ?? row.verdict
}

export function VerdictChip({ verdict, corrected, size = 'md', className }: { verdict: Verdict; corrected?: boolean; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      title={`${VERDICT_HELP[verdict]}${corrected ? ' (corrected by a reviewer)' : ''}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-bold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
        VERDICT_TONE[verdict],
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', VERDICT_DOT[verdict])} />
      {VERDICT_LABELS[verdict]}
      {corrected && <span className="font-medium opacity-70">· corrected</span>}
    </span>
  )
}

/** Status for a row that has no verdict yet (or never will). */
export function PendingChip({ row }: { row: Pick<ReviewRow, 'status' | 'skipReason'> }) {
  if (row.status === 'queued' || row.status === 'processing') {
    return <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500"><Sparkles className="h-3 w-3 animate-pulse text-[#093339]" />AI reviewing…</span>
  }
  if (row.status === 'failed') {
    return <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">Could not review</span>
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-400">
      {SKIP_REASON_LABELS[row.skipReason ?? ''] ?? 'Skipped'}
    </span>
  )
}

export const MOOD_TONE: Record<Mood, string> = {
  satisfied: 'text-green-700',
  neutral: 'text-slate-500',
  dissatisfied: 'text-orange-700',
  angry: 'text-rose-700',
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────

const IST = 'Asia/Kolkata'

export function istYmd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** "Today 2:41 pm", "Yesterday 11:05 am", "15 Sep 6:02 pm". */
export function callTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  const day = istYmd(d)
  const today = istYmd()
  const y = new Date(`${today}T00:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  if (day === today) return `Today ${time}`
  if (day === y.toISOString().slice(0, 10)) return `Yesterday ${time}`
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' }).format(d)} ${time}`
}

export function clock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function dueLabel(due: string | null, today: string): { text: string; tone: string } | null {
  if (!due) return null
  if (due < today) return { text: `Overdue · ${shortDate(due)}`, tone: 'bg-rose-50 text-rose-700 border-rose-200' }
  if (due === today) return { text: 'Due today', tone: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { text: `Due ${shortDate(due)}`, tone: 'bg-slate-50 text-slate-600 border-slate-200' }
}

export function shortDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${ymd}T00:00:00Z`))
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`)
  return body as T
}

// ── The Recordings tab's verdict column ──────────────────────────────────────────────────────────

/** One request per page of the Recordings tab: verdicts for the recordings on screen. */
export function useAiVerdicts(recordingIds: Array<string | null | undefined>, enabled: boolean) {
  const ids = [...new Set(recordingIds.filter(Boolean) as string[])].sort()
  return useQuery<VerdictLookup>({
    queryKey: ['call-ai-verdicts', ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => (await fetchJson<{ verdicts: VerdictLookup }>(`/api/call-analysis/ai/verdicts?ids=${ids.join(',')}`)).verdicts,
  })
}

/** A chip (click → the full review) or a quiet dash for calls outside the AI scope. */
export function AiVerdictCell({ entry, onOpen }: { entry: VerdictLookup[string] | undefined; onOpen: (reviewId: string) => void }) {
  if (!entry) {
    return <span title="AI review covers AM Hyundai calls for now" className="text-xs font-bold text-slate-300">—</span>
  }
  const verdict = entry.verdict
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      className="flex max-w-[220px] flex-col items-start gap-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40"
      aria-label="Open the AI review of this call"
    >
      {entry.status === 'done' && verdict ? <VerdictChip verdict={verdict} size="sm" /> : <PendingChip row={{ status: entry.status, skipReason: entry.skipReason }} />}
      {entry.headline && <span className="line-clamp-2 text-[11px] font-medium leading-snug text-slate-500">{entry.headline}</span>}
    </button>
  )
}
