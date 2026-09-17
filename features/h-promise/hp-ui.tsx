'use client'

import * as React from 'react'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Info, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { displayRegNo, normalizeRegNo } from '@/lib/h-promise/registration'
import { STAGE_LABELS, type AgingBucket, type VehicleStage } from '@/lib/h-promise/stage'
import { getApprovalInfo, getStatusInfo, type Flow } from '@/lib/h-promise/status'
import { DASH, inr, inrSigned, MONTH_NAMES } from './hp-format'

export type Tone = 'stock' | 'booked' | 'sold' | 'approved' | 'pending' | 'rejected' | 'neutral' | 'accent'

/**
 * Splits a registration key into the groups a plate is read in: JK02AB1234 → JK 02 AB 1234.
 * Anything that does not follow the letters/digits rhythm is shown as typed.
 */
function plateGroups(value: string): string {
  const key = normalizeRegNo(value)
  if (!key) return displayRegNo(value)
  const groups = key.match(/[A-Z]+|\d+/g)
  return groups ? groups.join(' ') : key
}

const PLATE_SIZES = {
  sm: { text: 'text-[12.5px] px-2 py-[3px]', strip: 'w-4.5 text-[6.5px]' },
  md: { text: 'text-[13.5px] px-2 py-1', strip: 'w-5 text-[7px]' },
  lg: { text: 'text-lg px-3 py-1.5', strip: 'w-7 text-[8px]' },
  xl: { text: 'text-2xl px-4 py-2', strip: 'w-9 text-[10px]' },
} as const

/** The section's signature: every registration number is shown as the plate people read it from. */
export function RegPlate({
  regNo,
  label,
  size = 'md',
  className,
}: {
  regNo?: string | null
  /** Shown exactly as written, for the section mark. A registration number goes in `regNo`. */
  label?: string
  size?: keyof typeof PLATE_SIZES
  className?: string
}) {
  const text = label ?? (regNo ? plateGroups(regNo) : DASH)
  const s = PLATE_SIZES[size]
  const ariaLabel = label ?? `Registration ${regNo ? displayRegNo(regNo) : 'not recorded'}`
  return (
    <span className={cn('hp-plate', className)} aria-label={ariaLabel} role="img">
      <span className={cn('hp-plate-strip', s.strip)} aria-hidden="true">
        <span className="hp-plate-dot" />
        IND
      </span>
      <span className={cn('hp-plate-text', s.text)}>{text}</span>
    </span>
  )
}

export function ToneChip({
  tone,
  children,
  dot = false,
  className,
  title,
}: {
  tone: Tone
  children: React.ReactNode
  dot?: boolean
  className?: string
  title?: string
}) {
  return (
    <span
      data-tone={tone}
      title={title}
      className={cn('hp-tone inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12.5px] font-semibold leading-4', className)}
    >
      {dot && <span className="hp-tone-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />}
      {children}
    </span>
  )
}

export const STAGE_TONE: Record<VehicleStage, Tone> = {
  in_stock: 'stock',
  booked: 'booked',
  sold: 'sold',
  deleted: 'neutral',
}

export function StageChip({ stage, className }: { stage: VehicleStage; className?: string }) {
  return (
    <ToneChip tone={STAGE_TONE[stage]} dot className={className}>
      {STAGE_LABELS[stage]}
    </ToneChip>
  )
}

/** Pass `managerStatus` wherever it is known: a waiting record then says which stage it waits on (GSM / SM or MD). */
export function StatusChip({ flow, status, managerStatus, className, prefix }: { flow: Flow; status: string | null | undefined; managerStatus?: string | null; className?: string; prefix?: string }) {
  const info = managerStatus === undefined ? getStatusInfo(flow, status) : getApprovalInfo(flow, status, managerStatus)
  const tone: Tone = info.tone === 'none' ? 'neutral' : info.tone
  return (
    <ToneChip tone={tone} className={className} title={info.waitingOn ? `Waiting on: ${info.waitingOn}` : undefined}>
      {prefix ? `${prefix} · ` : ''}{info.label}
    </ToneChip>
  )
}

// ── Surfaces ─────────────────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section aria-labelledby={headingId} id={id} className={cn('min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 id={headingId} className="text-[15px] font-semibold tracking-tight text-slate-900 [text-wrap:balance]">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** One surface, cells split by hairlines. */
export function Band({ children, cols = 6, className, label }: { children: React.ReactNode; cols?: 4 | 5 | 6; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', className)}>
      <div className="hp-band -mb-px -mr-px" data-cols={cols}>{children}</div>
    </section>
  )
}

export function BandCell({
  label,
  value,
  sub,
  tone,
  onClick,
  pressed,
  hint,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: Tone
  onClick?: () => void
  pressed?: boolean
  hint?: string
}) {
  const body = (
    <>
      {tone && <span className="hp-cell-tick" data-tone={tone} aria-hidden="true" />}
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      <span className="hp-num mt-1 block text-[22px] font-semibold leading-7 tracking-tight text-slate-900 sm:text-2xl">{value}</span>
      {sub && <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        data-tone={tone}
        className={cn('relative block w-full px-4 py-3.5 text-left', pressed ? 'hp-accent-soft' : 'hp-hover')}
      >
        {body}
      </button>
    )
  }
  return <div className="relative px-4 py-3.5 sm:px-5" data-tone={tone}>{body}</div>
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex cursor-help text-slate-400" title={text} aria-label={text} role="img">
      <Info className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="hp-sunken-bg flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center">
      {icon && <span data-tone="accent" className="hp-tone mb-1 inline-flex h-10 w-10 items-center justify-center rounded-xl">{icon}</span>}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {children && <p className="max-w-[55ch] text-xs leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" data-tone="rejected" className="hp-tone flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-semibold">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none', className)} />
}

export function LoadingBlock({ label = 'Loading', rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
    </div>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string; count?: number | null; tone?: Tone }>
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="hp-scroll hp-track inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-slate-200 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-colors',
              active ? 'bg-white text-slate-900 shadow-sm' : 'hp-muted-text hover:text-slate-900',
            )}
          >
            {option.tone && <span data-tone={option.tone} className="hp-tone-fill h-1.5 w-1.5 rounded-full" aria-hidden="true" />}
            {option.label}
            {typeof option.count === 'number' && (
              <span className={cn('hp-num rounded-full px-1.5 text-[10.5px]', active ? 'hp-accent-soft hp-accent-text' : 'hp-count hp-muted-text')}>
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
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  allLabel?: string
  className?: string
}) {
  const id = React.useId()
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-9 max-w-[15rem] truncate rounded-lg border bg-white pl-3 pr-8 text-xs font-semibold text-slate-700 transition-colors focus:outline-none',
          value ? 'hp-accent-ring border-transparent' : 'border-slate-200 hover:border-slate-300',
        )}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

/** The register search, styled as a blank number plate. */
export function PlateSearch({ value, onChange, placeholder = 'Search plate, model, buyer…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const id = React.useId()
  return (
    <div className="hp-plate relative h-9 min-w-[15rem] flex-1 sm:max-w-sm">
      <span className="hp-plate-strip w-6 text-[6.5px]" aria-hidden="true">
        <span className="hp-plate-dot" />
        IND
      </span>
      <label htmlFor={id} className="sr-only">Search vehicles</label>
      <Search className="pointer-events-none absolute left-9 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent pl-8 pr-8 text-[13px] font-semibold uppercase tracking-[0.06em] text-slate-900 placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export type ButtonVariant = 'accent' | 'approve' | 'reject' | 'outline' | 'soft' | 'ghost'

export const HpButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }
>(function HpButton({ variant = 'outline', size = 'md', busy = false, className, children, disabled, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn('hp-btn', className)}
      {...props}
    >
      {busy && <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {children}
    </button>
  )
})

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────

const AGING_TONE: Record<AgingBucket, Tone> = { '0-15': 'stock', '16-30': 'booked', '31-60': 'pending', '60+': 'rejected' }

export function AgingBar({ days, bucket }: { days: number | null; bucket: AgingBucket | null }) {
  if (days === null || bucket === null) return <span className="text-slate-400">{DASH}</span>
  const width = `${Math.min(100, Math.max(4, (days / 90) * 100))}%`
  return (
    <span className="flex min-w-[92px] items-center gap-2" title={`${days} days in stock`}>
      <span className="hp-age flex-1" data-tone={AGING_TONE[bucket]} aria-hidden="true">
        <span style={{ width }} />
      </span>
      <span className="hp-num w-10 text-right text-[13.5px] font-semibold text-slate-700">{days}d</span>
    </span>
  )
}

export function Money({ value, signed = false, className }: { value: number | null | undefined; signed?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className={cn('text-slate-400', className)}>{DASH}</span>
  const negative = value < 0
  return (
    <span data-tone={negative ? 'rejected' : signed && value > 0 ? 'sold' : undefined} className={cn('hp-num whitespace-nowrap', negative || (signed && value > 0) ? 'hp-tone-text' : '', className)}>
      {signed ? inrSigned(value) : inr(value)}
    </span>
  )
}

export function Field({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[12.5px] text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] font-medium text-slate-900">{children ?? DASH}</dd>
      {hint && <dd className="mt-0.5 text-[12px] text-slate-500">{hint}</dd>}
    </div>
  )
}

export function Dl({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-3', className)}>{children}</dl>
}

/** RC · KYC · Insurance · Ledger — the paperwork a sold car must carry, at a glance. */
export function DocDots({ present, sold }: { present: ReadonlyArray<string>; sold: boolean }) {
  const has = (kind: string) => present.includes(kind)
  const items: Array<{ label: string; ok: boolean; applies: boolean }> = [
    { label: 'RC', ok: has('rc'), applies: true },
    { label: 'KYC', ok: has('seller_pan') && has('seller_aadhaar'), applies: true },
    { label: 'Ins', ok: has('insurance_copy'), applies: true },
    { label: 'Ledger', ok: has('payment_ledger'), applies: sold },
  ]
  const summary = items.filter((item) => item.applies).map((item) => `${item.label} ${item.ok ? 'on file' : 'missing'}`).join(', ')
  return (
    <span className="inline-flex items-center gap-1" title={summary} aria-label={summary} role="img">
      {items.map((item) => (
        <span
          key={item.label}
          data-tone={!item.applies ? 'neutral' : item.ok ? 'approved' : sold ? 'rejected' : 'neutral'}
          className={cn(
            'hp-tone inline-flex h-5 items-center rounded px-1.5 text-[11px] font-bold uppercase tracking-wide',
            (!item.applies || (!item.ok && !sold)) && 'opacity-60',
          )}
        >
          {item.label}
        </span>
      ))}
    </span>
  )
}

export function Notice({ tone = 'accent', icon, children, className }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div data-tone={tone} className={cn('hp-tone flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-snug', className)}>
      {icon && <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export type MonthCalendarFilterProps = {
  value: string // YYYY-MM or ''
  onChange: (value: string) => void
  monthCounts?: Map<string, number>
  today?: string
  label?: string
  className?: string
}

export function MonthCalendarFilter({
  value,
  onChange,
  monthCounts,
  today = '',
  label = 'Bought in',
  className,
}: MonthCalendarFilterProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const currentYmd = today || new Date().toISOString().slice(0, 10)
  const currentYear = Number(currentYmd.slice(0, 4)) || 2026
  const currentMonthNum = Number(currentYmd.slice(5, 7)) || 9
  const currentMonthKey = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`

  // Work out last month key
  const lastMonthDate = new Date(currentYear, currentMonthNum - 2, 1)
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`

  const selectedYear = value ? Number(value.slice(0, 4)) : currentYear
  const [viewYear, setViewYear] = React.useState(selectedYear)

  // Sync viewYear if selected value changes from outside
  React.useEffect(() => {
    if (value) {
      setViewYear(Number(value.slice(0, 4)))
    }
  }, [value])

  // Close on outside click or Escape
  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const formattedSelected = React.useMemo(() => {
    if (!value) return 'Any month'
    if (value.length === 4) return `All of ${value}`
    const y = value.slice(0, 4)
    const m = Number(value.slice(5, 7))
    return `${MONTH_NAMES[m - 1] || value} ${y}`
  }, [value])

  const selectedCount = value ? (monthCounts?.get(value) ?? 0) : 0

  return (
    <div ref={containerRef} className={cn('relative inline-block text-left', className)}>
      {/* Trigger Button */}
      <div
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-xs font-semibold transition-all duration-150',
          open
            ? 'border-slate-400 ring-2 ring-slate-400/20 shadow-xs'
            : value
            ? 'border-slate-300 bg-slate-50 text-slate-900 shadow-xs'
            : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/50',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 text-left focus:outline-none"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${label}: ${formattedSelected}`}
        >
          <CalendarDays
            className={cn('h-3.5 w-3.5', value ? 'text-slate-900' : 'text-slate-400')}
            aria-hidden="true"
          />
          <span className="text-slate-500 font-medium">{label}:</span>
          <span className={cn('font-bold', value ? 'text-slate-900' : 'text-slate-700')}>
            {formattedSelected}
          </span>
          {value && selectedCount > 0 && (
            <span className="hp-num rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[10.5px] font-bold text-slate-800">
              {selectedCount}
            </span>
          )}
        </button>

        {value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Clear date filter"
            title="Clear date filter"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Modern Popover Calendar Card */}
      {open && (
        <div
          role="dialog"
          aria-label="Select month"
          className="absolute left-0 top-full z-50 mt-1.5 w-[310px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl transition-all animate-in fade-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Presets Row */}
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2.5 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                !value
                  ? 'hp-accent-bg text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              All time
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(currentMonthKey)
                setViewYear(currentYear)
                setOpen(false)
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                value === currentMonthKey
                  ? 'hp-accent-bg text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(lastMonthKey)
                setViewYear(lastMonthDate.getFullYear())
                setOpen(false)
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                value === lastMonthKey
                  ? 'hp-accent-bg text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              Last month
            </button>
          </div>

          {/* Year Header Navigator */}
          <div className="mb-3 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Previous year"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{viewYear}</span>
              {viewYear === currentYear && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  Current
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Next year"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* 12-Month Calendar Grid */}
          <div className="grid grid-cols-3 gap-2">
            {MONTH_NAMES.map((monthName, idx) => {
              const mNum = idx + 1
              const mKey = `${viewYear}-${String(mNum).padStart(2, '0')}`
              const isSelected = value === mKey
              const isCurrent = mKey === currentMonthKey
              const count = monthCounts?.get(mKey) ?? 0

              return (
                <button
                  key={monthName}
                  type="button"
                  onClick={() => {
                    onChange(mKey)
                    setOpen(false)
                  }}
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-lg border py-2 px-1.5 transition-all text-center',
                    isSelected
                      ? 'hp-accent-bg border-transparent text-white shadow-sm'
                      : isCurrent
                      ? 'border-blue-300 bg-blue-50/60 text-blue-900 hover:border-blue-400 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200'
                      : count > 0
                      ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      : 'border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-slate-800/50',
                  )}
                >
                  <span className={cn('text-xs font-bold', isSelected ? 'text-white' : '')}>
                    {monthName.slice(0, 3)}
                  </span>
                  <span
                    className={cn(
                      'hp-num mt-0.5 text-[10.5px] font-semibold',
                      isSelected
                        ? 'text-white/85'
                        : count > 0
                        ? 'text-slate-500 dark:text-slate-400'
                        : 'text-slate-300 dark:text-slate-700',
                    )}
                  >
                    {count > 0 ? `${count} cars` : '—'}
                  </span>
                  {isCurrent && !isSelected && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-600" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer bar */}
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-800"
              >
                <RotateCcw className="h-3 w-3" />
                Reset filter
              </button>
            ) : (
              <span className="text-[11px] text-slate-400">Click any month to filter</span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
