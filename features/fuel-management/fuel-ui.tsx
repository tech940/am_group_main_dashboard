'use client'

import * as React from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDashed, Info, OctagonAlert } from 'lucide-react'
import { INDIA_TIME_ZONE } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import type { FuelExceptionSeverity, FuelLifecycle, FuelTraceStep, FuelUnit } from '@/lib/fuel-management/types'

/*
 * ── Section tokens ─────────────────────────────────────────────────────────────────────────────
 * Primitive → semantic, scoped to `.fm`. The palette is the app's (slate, the dashboard accent, white);
 * only STATUS needs its own tokens, because app/globals.css repaints the emerald/amber/rose utilities
 * with !important and a status tone written that way is not the tone that renders. Neutrals stay on the
 * app's slate classes so the global dark-mode net keeps handling them.
 */
export const FUEL_TOKENS_CSS = `
.fm {
  --fm-ok: #047857; --fm-ok-bg: #ecfdf5; --fm-ok-line: #a7f3d0;
  --fm-review: #b45309; --fm-review-bg: #fffbeb; --fm-review-line: #fde68a;
  --fm-critical: #be123c; --fm-critical-bg: #fff1f2; --fm-critical-line: #fecdd3;
  --fm-info: #334155; --fm-info-bg: #f8fafc; --fm-info-line: #cbd5e1;
  --fm-muted: #64748b;
  --fm-rule: #e2e8f0;
  --fm-accent: var(--dashboard-primary, #0f172a);
  --fm-accent-rgb: 15, 23, 42;
  --fm-ink: #0f172a;
  --fm-bar-track: #f1f5f9;
}
.dark .fm {
  --fm-ok: #34d399; --fm-ok-bg: rgba(52, 211, 153, 0.12); --fm-ok-line: rgba(52, 211, 153, 0.3);
  --fm-review: #fde047; --fm-review-bg: rgba(234, 179, 8, 0.12); --fm-review-line: rgba(253, 224, 71, 0.3);
  --fm-critical: #fda4af; --fm-critical-bg: rgba(244, 63, 94, 0.12); --fm-critical-line: rgba(253, 164, 175, 0.3);
  --fm-info: #cbd5e1; --fm-info-bg: rgba(148, 163, 184, 0.12); --fm-info-line: rgba(148, 163, 184, 0.3);
  --fm-muted: #94a3b8;
  --fm-rule: rgba(148, 163, 184, 0.2);
  --fm-ink: #e2e8f0;
  --fm-bar-track: rgba(148, 163, 184, 0.16);
}
.fm table thead tr, .fm thead tr { background-color: #f8fafc !important; border-bottom: 1px solid #e2e8f0 !important; }
.fm table thead th, .fm thead th, .fm table th, .fm th { background-color: transparent !important; color: #475569 !important; font-weight: 600 !important; letter-spacing: normal !important; font-size: 12px !important; }
.fm table tbody th, .fm tbody th { background-color: transparent !important; color: #0f172a !important; font-weight: 500 !important; letter-spacing: normal !important; text-transform: none !important; font-size: 13px !important; }
.dark .fm table thead tr, .dark .fm thead tr { background-color: #0f172a !important; border-bottom: 1px solid #1e293b !important; }
.dark .fm table thead th, .dark .fm thead th, .dark .fm table th, .dark .fm th { color: #94a3b8 !important; }
.dark .fm table tbody th, .dark .fm tbody th { color: #f8fafc !important; }
.fm ::selection { background: rgba(var(--fm-accent-rgb), 0.15); }
.fm :focus-visible { outline: 2px solid var(--fm-accent); outline-offset: 2px; }
/* Controls inside a scrolling or clipping container draw their ring inside, or it is cut off. */
.fm .fm-inset-focus:focus-visible { outline-offset: -2px; }
.fm .fm-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
.fm .fm-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; }
@keyframes fm-sheet-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fm-fade-in { from { opacity: 0; } to { opacity: 1; } }
.fm-sheet[data-state='open'] { animation: fm-sheet-in 220ms cubic-bezier(0.16, 1, 0.3, 1); }
.fm-overlay[data-state='open'] { animation: fm-fade-in 160ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .fm-sheet[data-state='open'], .fm-overlay[data-state='open'] { animation: none; }
}
@media print {
  #app-sidebar, .dashboard-orb, .fm-noprint { display: none !important; }
  .fm .fm-scroll { overflow: visible !important; }
}
`

export function FuelTokens() {
  return <style>{FUEL_TOKENS_CSS}</style>
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────

const COUNT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const NUM1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const NUM2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const EFF = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const RUPEES_PAISE = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** A value and its unit never wrap onto separate lines. */
const NBSP = '\u00A0'

export const DASH = '—'

const ok = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value)

export function fmtInr(value: number | null | undefined): string {
  return ok(value) ? RUPEES.format(value) : DASH
}

export function fmtInrPrecise(value: number | null | undefined): string {
  return ok(value) ? RUPEES_PAISE.format(value) : DASH
}

export function fmtQty(value: number | null | undefined, unit: FuelUnit | string = 'L'): string {
  if (!ok(value)) return DASH
  return `${(Math.abs(value) >= 100 ? NUM1 : NUM2).format(value)}${NBSP}${unit}`
}

export function fmtKm(value: number | null | undefined): string {
  return ok(value) ? `${NUM1.format(value)}${NBSP}km` : DASH
}

export function fmtEff(value: number | null | undefined, unit: FuelUnit | string = 'L'): string {
  return ok(value) ? `${EFF.format(value)}${NBSP}km/${unit}` : DASH
}

export function fmtCount(value: number): string {
  return COUNT.format(value)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-16' → '16 Sep' (or '16 Sep 2026'). A calendar day, so no timezone is involved. */
export function fmtDay(ymd: string | null | undefined, withYear = false): string {
  if (!ymd) return DASH
  const [y, m, d] = ymd.slice(0, 10).split('-')
  const month = MONTHS[Number(m) - 1]
  if (!month) return ymd
  return withYear ? `${Number(d)}${NBSP}${month} ${y}` : `${Number(d)}${NBSP}${month}`
}

/** '1 – 16 Sep 2026'; both years shown when the range crosses one. */
export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDay(from, true)
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${fmtDay(from)} – ${fmtDay(to, true)}`
    : `${fmtDay(from, true)} – ${fmtDay(to, true)}`
}

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return DASH
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? DASH : DATE_TIME.format(date)
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/** Signed percentage change, or null when there is nothing honest to compare against. */
export function changePct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / previous) * 100
}

// ── Tones ───────────────────────────────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'review' | 'critical' | 'info' | 'muted'

/* Refined class strings with subtle borders and clean backgrounds */
const TONE_CHIP: Record<Tone, string> = {
  ok: 'text-emerald-800 bg-emerald-50/90 border-emerald-200/80 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800/80',
  review: 'text-amber-800 bg-amber-50/90 border-amber-200/80 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/80',
  critical: 'text-rose-800 bg-rose-50/90 border-rose-200/80 dark:text-rose-300 dark:bg-rose-950/40 dark:border-rose-800/80',
  info: 'text-slate-800 bg-slate-100/80 border-slate-200 dark:text-slate-200 dark:bg-slate-800/60 dark:border-slate-700',
  muted: 'text-slate-600 bg-slate-50/60 border border-slate-200 dark:text-slate-400 dark:bg-slate-900/40 dark:border-slate-700',
}

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  review: 'text-amber-700 dark:text-amber-400',
  critical: 'text-rose-700 dark:text-rose-400',
  info: 'text-slate-700 dark:text-slate-300',
  muted: 'text-slate-500 dark:text-slate-500',
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-600',
  review: 'bg-amber-600',
  critical: 'bg-rose-600',
  info: 'bg-slate-600',
  muted: 'bg-slate-400',
}

export function toneText(tone: Tone) {
  return TONE_TEXT[tone]
}

export function Chip({ tone, children, className, title }: { tone: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11.5px] font-medium leading-none transition-all',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone], className)} />
}

/** An empty cell: a quiet dash for the eye, words for a screen reader. */
export function NoValue({ label = 'not recorded' }: { label?: string }) {
  return (
    <>
      <span aria-hidden className="text-slate-300 font-medium">—</span>
      <span className="sr-only">{label}</span>
    </>
  )
}

/** A loading placeholder that is also announced. */
export function Loading({ children, label = 'Loading' }: { children: React.ReactNode; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  )
}

export const SEVERITY_TONE: Record<FuelExceptionSeverity, Tone> = { critical: 'critical', review: 'review', info: 'info' }
export const SEVERITY_WORD: Record<FuelExceptionSeverity, string> = { critical: 'Critical', review: 'Review', info: 'Note' }

export function SeverityIcon({ severity, className }: { severity: FuelExceptionSeverity; className?: string }) {
  const Icon = severity === 'critical' ? OctagonAlert : severity === 'review' ? AlertTriangle : Info
  return <Icon aria-hidden className={cn('size-4 shrink-0', TONE_TEXT[SEVERITY_TONE[severity]], className)} />
}

export const LIFECYCLE_TONE: Record<FuelLifecycle, Tone> = {
  in_review: 'info',
  on_hold: 'review',
  sent_back: 'review',
  rejected: 'muted',
  to_finalise: 'review',
  completed: 'ok',
}

/** "To Finalise" in Fuel Approvals is work still to do: here it says what is missing. */
export const LIFECYCLE_WORD: Record<FuelLifecycle, string> = {
  in_review: 'Awaiting approval',
  on_hold: 'On hold',
  sent_back: 'Sent back',
  rejected: 'Rejected',
  to_finalise: 'Bill pending',
  completed: 'Completed',
}

export function LifecycleChip({ lifecycle }: { lifecycle: FuelLifecycle }) {
  return <Chip tone={LIFECYCLE_TONE[lifecycle]}>{LIFECYCLE_WORD[lifecycle]}</Chip>
}

export type DataState = 'measured' | 'provisional' | 'partial' | 'estimated' | 'missing'

const DATA_STATE: Record<DataState, { tone: Tone; word: string; title: string }> = {
  measured: { tone: 'ok', word: 'Measured', title: 'Full tank to full tank, with odometer readings at both ends.' },
  provisional: { tone: 'info', word: 'Provisional', title: 'Fill to fill — no full-tank pair yet, so the figure may move.' },
  partial: { tone: 'review', word: 'Partial', title: 'Only part of the data behind this figure is recorded.' },
  estimated: { tone: 'info', word: 'Estimated', title: 'Includes fills with no bill, priced at the market rate set in Fuel settings.' },
  missing: { tone: 'muted', word: 'Not enough data', title: 'The records needed for this figure do not exist yet.' },
}

export function DataStateTag({ state, title }: { state: DataState; title?: string }) {
  const meta = DATA_STATE[state]
  return (
    <Chip tone={meta.tone} title={title ?? meta.title}>
      {state === 'missing' && <CircleDashed aria-hidden className="size-3" />}
      {meta.word}
    </Chip>
  )
}

// ── Layout primitives ───────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden', className)}
    >
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight text-slate-900 [text-wrap:balance]">
          {title}
        </h2>
        {action}
      </header>
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 sm:p-12">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {children && <p className="max-w-[55ch] text-xs font-normal leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none', className)} />
}

export function Bar({ pct, tone = 'accent', label, decorative = false }: { pct: number; tone?: 'accent' | Tone; label?: string; decorative?: boolean }) {
  const width = `${Math.max(0, Math.min(100, pct))}%`
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label ?? `${Math.round(pct)}%`}
      className="relative block h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none',
          tone === 'accent' ? 'bg-slate-700' : TONE_DOT[tone],
        )}
        style={{ width }}
      />
    </span>
  )
}

/**
 * A segmented control: a labelled group of toggle buttons (aria-pressed).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string; count?: number | null }[]
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={label} className="fm-scroll inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/80 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'fm-inset-focus inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150 active:scale-98 cursor-pointer',
              size === 'sm' ? 'h-7 px-2.5 text-[11.5px]' : 'h-7.5 px-3 text-xs',
              active ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
            )}
          >
            <span>{option.label}</span>
            {option.count !== undefined && option.count !== null && (
              <span className={cn('tabular-nums text-[10.5px] px-1.5 py-0.2 rounded-full font-medium', active ? 'bg-slate-100 text-slate-800' : 'bg-slate-200/70 text-slate-600')}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string; count?: number }[]
  allLabel: string
}) {
  const id = React.useId()
  const active = value !== ''
  return (
    <div className="flex min-w-0 items-center">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-8.5 max-w-[14rem] truncate rounded-lg border bg-white pl-3 pr-8 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-400',
          active
            ? 'border-slate-400 text-slate-900 bg-slate-50/80 font-semibold'
            : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/50',
        )}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}{option.count !== undefined ? ` (${option.count})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Change against the previous period of the same length, in words and a sign — never colour alone. */
export function Change({ current, previous, invert = false, unit = '%' }: { current: number; previous: number | null | undefined; invert?: boolean; unit?: string }) {
  const pct = changePct(current, previous)
  if (pct === null) return <span className="text-slate-500 text-xs font-normal">no earlier period</span>
  if (Math.abs(pct) < 0.5) return <span className="text-slate-500 text-xs font-normal">same as previous</span>
  const up = pct > 0
  const tone: Tone = (up !== invert) ? 'review' : 'ok'
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', toneText(tone))}>
      {up ? <ArrowUpRight aria-hidden className="size-3.5 stroke-[2]" /> : <ArrowDownRight aria-hidden className="size-3.5 stroke-[2]" />}
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      <span>{Math.abs(Math.round(pct))}{unit}</span>
      <span className="ml-1 text-slate-500 font-normal">vs prev</span>
    </span>
  )
}

// ── The fuel trace ──────────────────────────────────────────────────────────────────────────────

const STEP_THEMES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  requested: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-slate-500' },
  approved: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-emerald-600' },
  filled: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-emerald-600' },
  closed: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-slate-600' },
  driven: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-sky-600' },
  verified: { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-indigo-600' },
}

const STEP_WORD: Record<FuelTraceStep['state'], string> = {
  done: 'Recorded',
  pending: 'Waiting',
  missing: 'Missing',
  mismatch: 'Discrepancy',
  not_applicable: 'N/A',
}

/**
 * Fuel chain of custody visualizer.
 */
export function FuelTrace({
  steps,
  links,
  compact = false,
}: {
  steps: readonly Pick<FuelTraceStep, 'key' | 'label' | 'state' | 'value' | 'detail' | 'actor' | 'at'>[]
  /** Text on the connector AFTER each step (e.g. a difference). */
  links?: readonly (string | null)[]
  compact?: boolean
}) {
  return (
    <ol className={cn('grid gap-3 sm:gap-4', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6')}>
      {steps.map((step, index) => {
        const link = links?.[index] ?? null
        const isDone = step.state === 'done'
        const theme = STEP_THEMES[step.key] ?? { bg: 'bg-white', border: 'border-slate-200', text: 'text-slate-900', dot: 'bg-slate-500' }
        return (
          <li key={step.key} className={cn('relative flex flex-col justify-between p-4 rounded-xl border transition-all hover:border-slate-300', theme.bg, theme.border)}>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{step.label}</span>
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', isDone ? theme.dot : step.state === 'mismatch' ? 'bg-rose-500' : 'bg-amber-500')}
                />
              </div>

              <p className={cn('text-lg font-semibold tabular-nums tracking-tight', step.value ? theme.text : 'text-slate-400')}>
                {step.value ?? STEP_WORD[step.state]}
              </p>

              {step.value && !isDone && (
                <span className={cn('inline-block mt-1 text-[10.5px] font-medium uppercase px-2 py-0.5 rounded-md', step.state === 'mismatch' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200')}>
                  {STEP_WORD[step.state]}
                </span>
              )}

              {step.detail && <p className="mt-1.5 text-xs font-normal leading-snug text-slate-600">{step.detail}</p>}
            </div>

            {(step.actor || step.at || link) && (
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] font-medium text-slate-500">
                <span>{[step.actor, step.at ? fmtWhen(step.at) : null].filter(Boolean).join(' · ')}</span>
                {link && <span className="font-mono text-slate-700 font-medium bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{link}</span>}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-medium tabular-nums text-slate-900">{children}</dd>
      {hint && <dd className="mt-0.5 text-[11.5px] text-slate-500">{hint}</dd>}
    </div>
  )
}
