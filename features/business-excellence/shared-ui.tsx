'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type BusinessExcellenceOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

export type BusinessExcellenceBranchOption<T extends string> = {
  value: T
  label: string
  helper?: string
}

export type BusinessExcellenceToggleOption<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
}

function getInputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(value: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function AnalyticsDateRangePicker({
  title = 'Date Range',
  clearLabel = 'Clear range',
  startDate,
  endDate,
  onChange,
}: {
  title?: string
  clearLabel?: string
  startDate: string
  endDate: string
  onChange: (startDate: string, endDate: string) => void
}) {
  const initialViewDate = parseDate(startDate) || new Date()
  const [viewDate, setViewDate] = useState(() => new Date(initialViewDate.getFullYear(), initialViewDate.getMonth(), 1))
  const selectedStart = parseDate(startDate)
  const selectedEnd = parseDate(endDate)
  const monthLabel = viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const dayCells = useMemo(() => {
    const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
    const gridStart = new Date(monthStart)
    gridStart.setDate(monthStart.getDate() - monthStart.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      return date
    })
  }, [viewDate])

  const selectDate = (date: Date) => {
    const selected = getInputDate(date)
    if (!selectedStart || selectedEnd || date < selectedStart) {
      onChange(selected, '')
      return
    }
    onChange(startDate, selected)
  }

  return (
    <div className="solid-calendar-surface rounded-[1.25rem] border border-[var(--dashboard-primary-border)] bg-white p-2.5 shadow-sm transition">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          className="app-outline-action flex h-9 w-9 items-center justify-center rounded-xl bg-white"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
          <p className="text-sm font-black text-slate-950 dark:text-white">{monthLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          className="app-outline-action flex h-9 w-9 items-center justify-center rounded-xl bg-white"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`} className="py-0.5">{day}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {dayCells.map((date) => {
          const dateValue = getInputDate(date)
          const inCurrentMonth = date.getMonth() === viewDate.getMonth()
          const isStart = dateValue === startDate
          const isEnd = dateValue === endDate
          const inRange = selectedStart && selectedEnd && date >= selectedStart && date <= selectedEnd
          return (
            <button
              key={dateValue}
              type="button"
              onClick={() => selectDate(date)}
              className={cn(
                'h-8 rounded-lg bg-white text-[11px] font-black transition',
                inCurrentMonth ? 'text-slate-700 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600',
                inRange && 'bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]',
                (isStart || isEnd) && 'app-primary-action shadow-sm'
              )}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[11px] font-bold text-slate-600">
        <div className="flex items-center justify-between gap-3">
          <span>Start</span>
          <span className="font-black text-slate-950 dark:text-white">{startDate || 'Select date'}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>End</span>
          <span className="font-black text-slate-950 dark:text-white">{endDate || 'Select date'}</span>
        </div>
        {(startDate || endDate) && (
          <button type="button" onClick={() => onChange('', '')} className="mt-1 bg-white text-left text-[11px] font-black text-[lab(53_89.72_88.48)]">
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function BusinessExcellenceHeader<TReport extends string, TBranch extends string>({
  eyebrow,
  title,
  subtitle,
  icon,
  report,
  reports,
  branch,
  branches,
  activeDateLabel,
  activeComparisonText,
  freshnessText,
  datePanelMode,
  hasDateFilters,
  supportsComparison = true,
  onReportChange,
  onBranchChange,
  onOpenDate,
  onOpenCompare,
  onClearDates,
}: {
  eyebrow: string
  title: string
  subtitle: string
  icon?: ReactNode
  report: TReport
  reports: Array<BusinessExcellenceOption<TReport>>
  branch: TBranch
  branches: Array<BusinessExcellenceBranchOption<TBranch>>
  activeDateLabel?: string
  activeComparisonText?: string
  freshnessText?: string
  datePanelMode?: 'current' | 'compare' | null
  hasDateFilters?: boolean
  supportsComparison?: boolean
  onReportChange: (report: TReport) => void
  onBranchChange: (branch: TBranch) => void
  onOpenDate: () => void
  onOpenCompare: () => void
  onClearDates: () => void
}) {
  return (
    <div className="overflow-visible rounded-[1.25rem] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
              {icon || <Activity className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
              <h1 className="truncate text-lg font-black tracking-tight text-slate-900">{title}</h1>
              <p className="text-xs font-bold text-slate-600">{subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeDateLabel && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                  {activeDateLabel}
                </span>
              )}
              {freshnessText && (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
                  {freshnessText}
                </span>
              )}
              <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm" aria-label="Business Excellence branch filter">
                {branches.map((option) => {
                  const isActive = option.value === branch
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onBranchChange(option.value)}
                      className={cn(
                        'rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest transition',
                        isActive
                          ? 'bg-[var(--dashboard-action-bg)] text-white shadow-sm'
                          : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      )}
                      title={option.helper}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {activeComparisonText && (
                <span className="rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1.5 text-[10px] font-black text-[var(--dashboard-action-bg)]">
                  {activeComparisonText}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={report} onValueChange={(value) => onReportChange(value as TReport)}>
              <SelectTrigger className="h-9 w-[220px] rounded-xl border border-teal-200/80 bg-white/65 text-xs font-bold text-slate-700 shadow-sm">
                <SelectValue placeholder="Choose a report" />
              </SelectTrigger>
              <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
                {reports.map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="m-1 rounded-lg text-xs font-bold">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={onOpenDate}
              className="h-9 rounded-xl border border-teal-200/80 bg-white/65 px-3 text-xs font-black text-slate-700 shadow-sm hover:border-teal-300 hover:bg-white/85"
            >
              <SlidersHorizontal className="mr-2 inline h-3.5 w-3.5" />
              {datePanelMode === 'current' ? 'Hide Date' : 'Select Date'}
            </button>
            {supportsComparison && (
              <button
                type="button"
                onClick={onOpenCompare}
                className={cn(
                  'h-9 rounded-xl px-3 text-xs font-black shadow-sm',
                  datePanelMode === 'compare' || activeComparisonText ? 'app-primary-action' : 'app-outline-action bg-white'
                )}
              >
                <CalendarDays className="mr-2 inline h-3.5 w-3.5" />
                {datePanelMode === 'compare' ? 'Hide Compare' : 'Compare Dates'}
              </button>
            )}
            {hasDateFilters && (
              <button type="button" onClick={onClearDates} className="app-outline-action h-9 rounded-xl bg-white px-3 text-xs font-black shadow-sm">
                <X className="mr-2 inline h-3.5 w-3.5" />
                Reset Dates
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function BusinessExcellenceDatePanel({
  mode,
  startDate,
  endDate,
  compareStartDate,
  compareEndDate,
  onApply,
  onClear,
}: {
  mode: 'current' | 'compare'
  startDate: string
  endDate: string
  compareStartDate: string
  compareEndDate: string
  onApply: (values: { startDate: string; endDate: string; compareStartDate: string; compareEndDate: string }) => void
  onClear: () => void
}) {
  const [draft, setDraft] = useState({ startDate, endDate, compareStartDate, compareEndDate })

  const canApply = mode === 'compare'
    ? Boolean(draft.startDate && draft.endDate && draft.compareStartDate && draft.compareEndDate)
    : Boolean(draft.startDate && draft.endDate)

  return (
    <div className="solid-calendar-surface rounded-b-[1.25rem] border border-t-0 border-slate-200 bg-white p-3 shadow-sm">
      <div className={cn('mx-auto grid gap-3', mode === 'compare' ? 'max-w-[860px]' : 'max-w-[640px]')}>
        <div className="solid-calendar-surface flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 text-xs font-black text-slate-950 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{mode === 'compare' ? 'CY Range' : 'Selected Range'}</p>
              <p>{draft.startDate || '-'} to {draft.endDate || '-'}</p>
            </div>
            {mode === 'compare' && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">LY Range</p>
                <p>{draft.compareStartDate || '-'} to {draft.compareEndDate || '-'}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canApply}
              onClick={() => onApply(draft)}
              className="app-primary-action calendar-apply-action h-10 rounded-xl px-5 text-xs font-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              Apply
            </button>
            <button type="button" onClick={onClear} className="app-outline-action h-10 rounded-xl bg-white px-5 text-xs font-black">
              Clear
            </button>
          </div>
        </div>
        <div className={cn('grid gap-3', mode === 'compare' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
          <AnalyticsDateRangePicker
            title={mode === 'compare' ? 'CY Date Range' : 'Current Date Range'}
            clearLabel={mode === 'compare' ? 'Clear CY range' : 'Clear current range'}
            startDate={draft.startDate}
            endDate={draft.endDate}
            onChange={(nextStart, nextEnd) => setDraft((current) => ({ ...current, startDate: nextStart, endDate: nextEnd }))}
          />
          {mode === 'compare' && (
            <AnalyticsDateRangePicker
              title="LY Date Range"
              clearLabel="Clear LY range"
              startDate={draft.compareStartDate}
              endDate={draft.compareEndDate}
              onChange={(nextStart, nextEnd) => setDraft((current) => ({ ...current, compareStartDate: nextStart, compareEndDate: nextEnd }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function BusinessTabButtons<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<BusinessExcellenceToggleOption<T>>
  active: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex w-full flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex min-w-[136px] flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition',
            active === option.value ? 'app-primary-action shadow-md' : 'app-outline-action bg-white text-slate-700'
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function BusinessMetricButtons<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<BusinessExcellenceToggleOption<T>>
  active: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-[0.15em] transition',
            active === option.value ? 'app-primary-action shadow-md' : 'executive-table-metric-button bg-white'
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function BusinessGrowthBadge({ value, label }: { value: number | null; label: string }) {
  const tone = value === null || !Number.isFinite(value)
    ? 'executive-growth-badge-neutral'
    : value >= 0
      ? 'executive-growth-badge-positive'
      : 'executive-growth-badge-negative'
  return (
    <span className={cn('executive-growth-badge inline-flex justify-center rounded-full border bg-white px-2.5 py-1 text-[10px] font-black', tone)}>
      {label}
    </span>
  )
}
