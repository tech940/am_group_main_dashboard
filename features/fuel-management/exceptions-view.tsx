'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { FuelExceptionReview, FuelExceptionRow, FuelExceptionSeverity, FuelManagementResponse } from '@/lib/fuel-management/types'
import type { FuelNavigate } from './fuel-management-client'
import { sendFuel } from './fuel-data'
import { Chip, EmptyState, Panel, SEVERITY_TONE, SEVERITY_WORD, Segmented, SeverityIcon, fmtDay, fmtWhen } from './fuel-ui'

type QueueFilter = 'open' | FuelExceptionSeverity | 'reviewed' | 'all'

const OUTCOMES: { value: FuelExceptionReview['outcome']; label: string; hint: string }[] = [
  { value: 'explained', label: 'Explained', hint: 'There is a reason, and it is fine.' },
  { value: 'data_error', label: 'Data error', hint: 'A figure was typed wrong — correct it in Fuel Approvals.' },
  { value: 'follow_up', label: 'Needs follow-up', hint: 'Someone has to look into it further.' },
]

const OUTCOME_WORD: Record<FuelExceptionReview['outcome'], string> = {
  explained: 'Explained',
  data_error: 'Data error',
  follow_up: 'Needs follow-up',
}

function measure(row: FuelExceptionRow): string | null {
  if (row.measured === null) return null
  const unit = row.unit ?? ''
  const value = `${row.measured.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}`.trim()
  if (row.expected === null) return value
  return `${value} vs ${row.expected.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}`.trim()
}

export function ExceptionsView({
  data,
  navigate,
  focusKey,
  onFocusHandled,
}: {
  data: FuelManagementResponse
  navigate: FuelNavigate
  focusKey: string
  onFocusHandled: () => void
}) {
  const [filter, setFilter] = React.useState<QueueFilter>('open')
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const rows = data.exceptions
  const open = rows.filter((r) => !r.review)

  React.useEffect(() => {
    if (!focusKey) return
    setFilter('all')
    setExpanded(focusKey)
    onFocusHandled()
    window.requestAnimationFrame(() => {
      const item = document.getElementById(`fm-exc-${cssSafe(focusKey)}`)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      item?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      item?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus({ preventScroll: true })
    })
  }, [focusKey, onFocusHandled])

  const shown = rows.filter((r) => {
    if (filter === 'all') return true
    if (filter === 'reviewed') return Boolean(r.review)
    if (filter === 'open') return !r.review
    return !r.review && r.severity === filter
  })

  return (
    <Panel
      id="fm-exceptions"
      title="Exceptions to review"
      bodyClassName="p-0"
      action={
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          label="Show exceptions"
          options={[
            { value: 'open', label: 'Open', count: open.length },
            { value: 'critical', label: 'Critical', count: open.filter((r) => r.severity === 'critical').length },
            { value: 'review', label: 'Review', count: open.filter((r) => r.severity === 'review').length },
            { value: 'info', label: 'Notes', count: open.filter((r) => r.severity === 'info').length },
            { value: 'reviewed', label: 'Reviewed', count: rows.length - open.length },
            { value: 'all', label: 'All' },
          ]}
        />
      }
    >
      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
        Each exception states a measurement that looks unusual. It is a reason to look, not a finding — open one to see the
        figures behind it, then record what you found.
      </div>
      {shown.length === 0 ? (
        <div className="p-6">
          <EmptyState title={filter === 'open' ? 'No open exceptions' : 'Nothing in this list'}>
            {filter === 'open' ? 'Every exception for this period has been reviewed, or none was found.' : 'Choose another list above.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((row) => (
            <ExceptionItem
              key={row.key}
              row={row}
              expanded={expanded === row.key}
              onToggle={() => setExpanded((current) => (current === row.key ? null : row.key))}
              navigate={navigate}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function cssSafe(key: string) {
  return key.replace(/[^A-Za-z0-9_-]/g, '_')
}

function ExceptionItem({
  row,
  expanded,
  onToggle,
  navigate,
}: {
  row: FuelExceptionRow
  expanded: boolean
  onToggle: () => void
  navigate: FuelNavigate
}) {
  const panelId = `fm-exc-panel-${cssSafe(row.key)}`
  const figures = measure(row)
  return (
    <li id={`fm-exc-${cssSafe(row.key)}`} className={cn(expanded && 'bg-slate-50/70')}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-start gap-3.5 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-slate-50/80"
      >
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100/80 ring-1 ring-slate-200/50">
          <SeverityIcon severity={row.severity} className="size-4" />
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[13.5px] font-semibold text-slate-900">{row.title}</span>
            <Chip tone={SEVERITY_TONE[row.severity]}>{row.label}</Chip>
            {row.review && <Chip tone="ok">{OUTCOME_WORD[row.review.outcome]}</Chip>}
          </span>
          <span className="mt-1 line-clamp-2 block text-[12.5px] text-slate-500">
            <span className="font-medium text-slate-700">{row.vehicleLabel}</span>
            {row.branchLabel ? ` · ${row.branchLabel}` : ''} · {fmtDay(row.date)}
            {figures ? <span className="font-mono text-slate-600"> · {figures}</span> : ''}
          </span>
        </span>
        <span className="sr-only">{SEVERITY_WORD[row.severity]}</span>
        <ChevronDown
          aria-hidden
          className={cn('mt-1 size-4 shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-180 text-slate-700')}
        />
      </button>
      {expanded && (
        <div id={panelId} className="space-y-3.5 border-t border-slate-100/60 bg-white/70 px-5 pb-5 pt-3.5 pl-14 sm:pl-16">
          <p className="max-w-[72ch] text-[13px] leading-relaxed text-slate-700">{row.message}</p>
          <div className="flex flex-wrap gap-2">
            {row.eventId && (
              <button
                type="button"
                onClick={() => navigate.openRecord(row.eventId as string)}
                className="inline-flex h-8 items-center rounded-xl border border-slate-200/90 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:text-slate-900"
              >
                Open {row.requestNumber ?? 'record'}
              </button>
            )}
            {row.vehicleKey && !row.vehicleKey.startsWith('LABEL:') && (
              <button
                type="button"
                onClick={() => navigate.openVehicle(row.vehicleKey as string)}
                className="inline-flex h-8 items-center rounded-xl border border-slate-200/90 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:text-slate-900"
              >
                Open vehicle
              </button>
            )}
            {row.passNo && (
              <Link
                href="/gate-pass"
                className="inline-flex h-8 items-center rounded-xl border border-slate-200/90 bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:text-slate-900"
              >
                Open Gate Pass <span className="sr-only">(look for {row.passNo})</span>
              </Link>
            )}
          </div>
          {row.review ? (
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center gap-2 text-[12px] text-slate-500">
                <span className="font-bold text-slate-800">{OUTCOME_WORD[row.review.outcome]}</span>
                <span>·</span>
                <span>{row.review.reviewerName}</span>
                <span>·</span>
                <span>{fmtWhen(row.review.at)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">{row.review.note}</p>
            </div>
          ) : null}
          <ReviewForm row={row} again={Boolean(row.review)} />
        </div>
      )}
    </li>
  )
}

function ReviewForm({ row, again }: { row: FuelExceptionRow; again: boolean }) {
  const queryClient = useQueryClient()
  const [show, setShow] = React.useState(!again)
  const [outcome, setOutcome] = React.useState<FuelExceptionReview['outcome'] | ''>('')
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<{ field: 'outcome' | 'note' | 'save'; text: string } | null>(null)
  const noteId = `fm-note-${cssSafe(row.key)}`
  const errorId = `fm-review-error-${cssSafe(row.key)}`
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const toggleRef = React.useRef<HTMLButtonElement | null>(null)
  const openedByToggle = React.useRef(false)

  React.useEffect(() => {
    if (show && openedByToggle.current) {
      formRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
      openedByToggle.current = false
    }
  }, [show])

  if (!show) {
    return (
      <button
        ref={toggleRef}
        type="button"
        onClick={() => {
          openedByToggle.current = true
          setShow(true)
        }}
        className="inline-flex min-h-7 items-center text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline cursor-pointer"
      >
        Review again
      </button>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!outcome) {
      setError({ field: 'outcome', text: 'Choose what you found.' })
      formRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
      return
    }
    if (note.trim().length < 3) {
      setError({ field: 'note', text: 'Add a short note saying what you found.' })
      document.getElementById(noteId)?.focus()
      return
    }
    setError(null)
    setSaving(true)
    try {
      await sendFuel('/api/fuel-management/exceptions/review', 'POST', {
        key: row.key,
        kind: row.kind,
        outcome,
        note: note.trim(),
        fuelApprovalId: row.eventId,
        subjectLabel: row.vehicleLabel,
      })
      toast({ title: 'Review recorded', description: `${row.title} — ${OUTCOME_WORD[outcome]}.`, variant: 'success' })
      setOutcome('')
      setNote('')
      setShow(false)
      await queryClient.invalidateQueries({ queryKey: ['fuel-management'] })
    } catch (err) {
      setError({ field: 'save', text: err instanceof Error ? err.message : 'The review could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs" noValidate>
      <fieldset aria-invalid={error?.field === 'outcome' || undefined} aria-describedby={error?.field === 'outcome' ? errorId : undefined}>
        <legend className="mb-2 text-[12px] font-bold text-slate-800">What did you find?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OUTCOMES.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col rounded-xl border p-3 transition-all duration-150',
                outcome === option.value
                  ? 'border-teal-600 bg-teal-50/50 shadow-2xs ring-1 ring-teal-600'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50',
              )}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-900">
                <input
                  type="radio"
                  name={`outcome-${row.key}`}
                  value={option.value}
                  checked={outcome === option.value}
                  onChange={() => setOutcome(option.value)}
                  className="accent-teal-700"
                />
                {option.label}
              </span>
              <span className="mt-1 text-[11.5px] leading-snug text-slate-500">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={noteId} className="mb-1.5 block text-[12px] font-bold text-slate-800">Note</label>
        <textarea
          id={noteId}
          name="review-note"
          aria-invalid={error?.field === 'note' || undefined}
          aria-describedby={error?.field === 'note' ? errorId : undefined}
          rows={2}
          maxLength={600}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Filled twice for the Srinagar trip; both slips checked…"
          className="w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/10"
        />
      </div>
      {error && <p id={errorId} role="alert" className="text-[12.5px] font-medium text-rose-600">{error.text}</p>}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 text-[12.5px] font-semibold text-white shadow-2xs transition-all hover:bg-teal-800 disabled:opacity-60"
        >
          {saving && <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
          {saving ? 'Saving…' : 'Record review'}
        </button>
        {again && (
          <button
            type="button"
            onClick={() => {
              setShow(false)
              window.setTimeout(() => toggleRef.current?.focus(), 0)
            }}
            className="h-8.5 px-3 text-[12.5px] font-semibold text-slate-500 hover:text-slate-900"
          >
            Cancel
          </button>
        )}
        <span className="text-[11.5px] text-slate-500">Reviews are kept; a later review does not erase an earlier one.</span>
      </div>
    </form>
  )
}
