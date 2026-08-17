'use client'

/**
 * MD queue for payment-window extension requests.
 *
 * The decision is small: someone wants N more days, and the only counterweight is how many other
 * customers are waiting for that same car. Colour carries roles, not decoration — the accent marks
 * the number being decided, amber marks the cost, emerald marks all-clear.
 *
 * Four things are deliberate, and the reasons matter if you are tempted to undo them:
 *
 *  1. **The car is never repeated on a competing row.** A contender only appears if its model,
 *     variant AND colour match the subject car — that is the matching rule — so printing the car on
 *     every row repeats the header verbatim. Rows show only what DIFFERS: who, when, newer, outlet.
 *  2. **No status pill inside a status-filtered tab.** "PENDING" on every row of the Pending tab is
 *     noise; the pill appears only in All, where it discriminates.
 *  3. **Every surface is a token, never a raw light colour.** The dark tokens live under
 *     `.dark .kia-premium`, and this component renders inside that scope (the shell is
 *     `kia-proforma-shell kia-premium`). A hardcoded `bg-white` therefore keeps a white ground while
 *     `--kia-text` flips to #f1f5f9 — measured 1.1:1, i.e. invisible. Semantic amber/emerald/rose
 *     tints have no token equivalents, so they carry explicit `dark:` variants instead.
 *  4. **Interactive controls are 44px on touch, 36px from `sm` up.** An MD approving from a phone is
 *     a real usage scene for this screen.
 */

import { useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type CompetingBooking = {
  bookingId: string
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  bookingStatus: string | null
  createdAt: string
  isNewerThanAllocation: boolean
  sameDealer: boolean
}

type RequestRow = {
  id: string
  bookingId: string
  allocationId: string
  vinNumber: string
  requestedDays: number
  baseHours: number
  reason: string
  status: string
  approvedDays: number | null
  requestedByName: string
  actionByName: string | null
  actionRemarks: string | null
  actionAt: string | null
  appliedExpiresAt: string | null
  createdAt: string
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  bookingStatus: string | null
  allocationStatus: string | null
  expiresAt: string | null
  competingBookings: CompetingBooking[]
  competingCount: number
  competingNewerCount: number
}

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
] as const
type Tab = typeof TABS[number]['key']

/** 44px on touch, 36px once there is a precise pointer. */
const CONTROL_H = 'h-11 sm:h-9'

function absolute(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d)
}

/** Relative time reads faster when scanning a queue. */
function relative(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return '—'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

/**
 * Relative label with the exact stamp attached.
 *
 * `<time dateTime>` rather than a bare span with `title`: title alone is unreachable by keyboard,
 * unreliable for screen readers and absent on touch, so the precise value had no accessible home.
 */
function When({ value, className }: { value: string | null; className?: string }) {
  if (!value) return <span className={className}>—</span>
  return (
    <time dateTime={value} title={absolute(value)} className={className}>
      {relative(value)}
    </time>
  )
}

function standardDays(hours: number) {
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`
}

/** Car identity, said once, without the model/variant duplication the DMS puts in both fields. */
function describeCar(model: string | null, variant: string | null, color: string | null) {
  const head = (variant || '').trim() || (model || '').trim()
  return [head, (color || '').trim()].filter(Boolean).join(' · ')
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'APPROVED'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    : status === 'REJECTED'
      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', tone)}>
      {status.toLowerCase()}
    </span>
  )
}

/** The ask as one expression: 3d → 7d. The resulting window gets the accent and the weight. */
function Delta({ from, to, granted, size = 'sm' }: {
  from: string
  to: number
  granted?: number | null
  size?: 'sm' | 'lg'
}) {
  const final = granted ?? null
  const adjusted = final !== null && final !== to
  const result = final ?? to
  const big = size === 'lg'
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
      <span className={cn('font-medium text-[var(--kia-text-soft)]', big ? 'text-lg' : 'text-sm')}>{from}</span>
      <ArrowRight aria-hidden className={cn('shrink-0 self-center text-[var(--kia-text-soft)]', big ? 'h-4 w-4' : 'h-3 w-3')} />
      {/* --kia-text-faint measures 2.57:1 and this is real information (what was asked for, before
          the MD trimmed it), so it takes -soft. faint is for decoration only. */}
      {adjusted && (
        <span className={cn('font-medium text-[var(--kia-text-soft)] line-through', big ? 'text-lg' : 'text-sm')}>{to}d</span>
      )}
      <span
        className={cn(
          'font-bold leading-none',
          big ? 'text-[1.75rem]' : 'text-base',
          adjusted ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--kia-accent-text)]',
        )}
      >
        {result}d
      </span>
    </span>
  )
}

/** A request for the same length as the standard window adds nothing — worth saying out loud. */
function extraDays(baseHours: number, requestedDays: number) {
  return requestedDays - Math.round(baseHours / 24)
}

export function PaymentWindowRequestsPage() {
  const queryClient = useQueryClient()
  const tabsId = useId()
  const [tab, setTab] = useState<Tab>('PENDING')
  const [active, setActive] = useState<RequestRow | null>(null)
  const [days, setDays] = useState('')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)

  const query = useQuery<{ rows: RequestRow[] }>({
    queryKey: ['kia-payment-window-requests', tab],
    queryFn: async () => {
      const qs = tab === 'ALL' ? '' : `?status=${tab}`
      const res = await fetch(`/api/brands/kia/bookings/payment-window-requests${qs}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to load requests')
      }
      return res.json()
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const rows = query.data?.rows ?? []
  const pendingCount = useMemo(
    () => (tab === 'PENDING' ? rows.length : rows.filter((r) => r.status === 'PENDING').length),
    [rows, tab],
  )

  const action = useMutation({
    mutationFn: async (input: { id: string; action: 'APPROVE' | 'REJECT'; approvedDays?: number; remarks?: string }) => {
      const res = await fetch(`/api/brands/kia/bookings/payment-window-requests/${input.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: input.action, approvedDays: input.approvedDays, remarks: input.remarks }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Failed to action the request')
      return payload
    },
    onSuccess: () => {
      setActive(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['kia-payment-window-requests'] })
      void queryClient.invalidateQueries({ queryKey: ['kia-bookings'] })
    },
    // A 409 lands here (already decided, reservation lapsed, payment taken). Keep the dialog open
    // with the reason, so the MD learns why nothing happened instead of clicking again.
    onError: (err: Error) => setError(err.message),
  })

  /**
   * `role="tablist"` is a promise that the arrows work; without this the role advertises keyboard
   * behaviour that does not exist, which is worse than leaving the role off. Automatic activation
   * (focus selects) is the right variant here — switching tabs is cheap and non-destructive.
   */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    let next = -1
    if (step !== 0) {
      next = (TABS.findIndex((t) => t.key === tab) + step + TABS.length) % TABS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = TABS.length - 1
    } else {
      return
    }
    event.preventDefault()
    setTab(TABS[next].key)
    document.getElementById(`${tabsId}-tab-${TABS[next].key}`)?.focus()
  }

  function openReview(row: RequestRow) {
    setActive(row)
    setDays(String(row.requestedDays))
    setRemarks('')
    setError(null)
  }

  return (
    // Capped: at full width on a wide monitor the action sat ~1800px from the customer name, so the
    // eye crossed a screen of dead space to connect a row to its button.
    <div className="max-w-5xl">
      <div
        role="tablist"
        aria-label="Filter requests by status"
        className="flex flex-wrap items-center gap-1 border-b pb-3"
        style={{ borderColor: 'var(--kia-hairline)' }}
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((t) => {
          const selected = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              // Roving tabindex: a tablist is ONE tab stop, and the arrow keys move within it.
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-bold transition-colors sm:min-h-0 sm:py-1.5',
                // ring- is the one genuinely ambiguous arbitrary utility (width vs colour), so it
                // needs the [color:…] hint. text-/border-/divide-/bg- resolve fine unhinted here.
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--kia-accent-text)] focus-visible:ring-offset-1',
                selected
                  ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)]'
                  : 'text-[var(--kia-text-soft)] hover:bg-[var(--kia-surface-sunken)]',
              )}
            >
              {t.label}
              {t.key === 'PENDING' && pendingCount > 0 && (
                <span className={cn('ml-1.5 tabular-nums', selected ? 'opacity-80' : 'text-rose-600 dark:text-rose-400')}>
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
        {/* Announced, not just spun. */}
        <span className="sr-only" aria-live="polite">
          {query.isFetching ? 'Loading requests' : `${rows.length} requests shown`}
        </span>
        {query.isFetching && (
          <Loader2 aria-hidden className="ml-2 h-3.5 w-3.5 animate-spin text-[var(--kia-text-soft)]" />
        )}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-busy={query.isFetching} tabIndex={-1}>
        {query.isError && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
            {(query.error as Error).message}
          </p>
        )}

        {!query.isLoading && !query.isError && rows.length === 0 && (
          <div className="py-20 text-center">
            <Clock3 aria-hidden className="mx-auto h-6 w-6 text-[var(--kia-text-soft)]" />
            <p className="mt-3 text-sm font-bold text-[var(--kia-text)]">Nothing waiting</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--kia-text-soft)]">
              Requests land here when a consultant asks for longer than the standard payment window
              while allotting a car.
            </p>
          </div>
        )}

        {/* divide-y needs divide-<color>, not an inline borderColor on the <ul>: border-color is not
            an inherited property, so the children fall back to currentColor and the hairlines render
            at full text weight. */}
        <ul className="divide-y divide-[var(--kia-hairline)]">
          {rows.map((row) => {
            const pending = row.status === 'PENDING'
            const newer = row.competingNewerCount
            const others = row.competingCount
            // Amber only when someone booked this car AFTER it was allotted — that is when granting
            // time actually costs another customer. A plain match is information, not a warning.
            const chipTone = newer > 0
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            return (
              <li key={row.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-bold text-[var(--kia-text)]">{row.customerName || '—'}</span>
                    {tab === 'ALL' && <StatusPill status={row.status} />}
                    {pending && others > 0 && (
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', chipTone)}>
                        <Users aria-hidden className="h-3 w-3" />
                        {newer > 0 ? `${newer} waiting` : `${others} match`}
                      </span>
                    )}
                  </div>

                  <p className="mt-0.5 truncate text-xs text-[var(--kia-text-soft)]">
                    {describeCar(row.model, row.variant, row.color)} · {row.bookingNumber || '—'}
                  </p>

                  {/* line-clamp rather than truncate: two lines of a reason is usually the whole thing. */}
                  <p className="mt-1.5 line-clamp-2 text-xs italic text-[var(--kia-text-soft)]">
                    &ldquo;{row.reason}&rdquo;
                  </p>

                  <p className="mt-1 text-[11px] text-[var(--kia-text-soft)]">
                    {row.requestedByName} · <When value={row.createdAt} />
                    {!pending && row.actionByName && (
                      <> · {row.status === 'APPROVED' ? 'approved' : 'rejected'} by {row.actionByName}</>
                    )}
                  </p>

                  {!pending && row.actionRemarks && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[var(--kia-text-soft)]">
                      MD: {row.actionRemarks}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                  <div className="text-left sm:text-right">
                    <Delta from={standardDays(row.baseHours)} to={row.requestedDays} granted={pending ? null : row.approvedDays} />
                    {pending && extraDays(row.baseHours, row.requestedDays) <= 0 && (
                      <p className="mt-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">no extra time</p>
                    )}
                  </div>
                  {pending ? (
                    <Button
                      type="button"
                      onClick={() => openReview(row)}
                      className={cn(CONTROL_H, 'rounded-lg bg-[var(--dashboard-action-bg)] px-4 text-xs font-bold text-[var(--dashboard-action-fg)] hover:bg-[var(--dashboard-action-hover)]')}
                    >
                      Review<span className="sr-only"> request from {row.customerName}</span>
                    </Button>
                  ) : (
                    <span className="text-[11px] text-[var(--kia-text-soft)] sm:w-[4.5rem] sm:text-right">
                      <When value={row.actionAt} />
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <Dialog open={Boolean(active)} onOpenChange={(open) => { if (!open) { setActive(null); setError(null) } }}>
        <DialogContent className="kia-premium flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border-0 bg-[var(--kia-surface)] p-0">
          {active && (
            <>
              <DialogHeader className="space-y-1 px-5 pt-5 text-left">
                <DialogTitle className="text-lg font-bold tracking-tight text-[var(--kia-text)]">
                  {active.customerName}
                </DialogTitle>
                <p className="text-xs text-[var(--kia-text-soft)]">
                  {describeCar(active.model, active.variant, active.color)}
                </p>
                <p className="font-mono text-[10px] text-[var(--kia-text-soft)]">
                  {active.bookingNumber} · {active.vinNumber}
                </p>
              </DialogHeader>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {/* Zone 1 — THE ASK. --kia-accent-soft is already dark-aware. */}
                <div
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: 'var(--kia-accent-soft)',
                    border: '1px solid rgba(var(--dashboard-primary-rgb), 0.16)',
                  }}
                >
                  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--kia-text-soft)]">
                        Payment window
                      </p>
                      <Delta from={standardDays(active.baseHours)} to={active.requestedDays} size="lg" />
                    </div>
                    <div className="text-right">
                      {extraDays(active.baseHours, active.requestedDays) > 0 ? (
                        <p className="text-sm font-bold text-[var(--kia-accent-text)]">
                          +{extraDays(active.baseHours, active.requestedDays)} days
                        </p>
                      ) : (
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400">adds no extra time</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-[var(--kia-text-soft)]">
                        {active.allocationStatus === 'transferring'
                          ? 'in transit — starts on arrival'
                          : <>due {absolute(active.expiresAt)}</>}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Zone 2 — THEIR WORDS. */}
                <div className="rounded-xl px-4 py-3" style={{ background: 'var(--kia-surface-sunken)' }}>
                  <p className="text-xs italic leading-relaxed text-[var(--kia-text)]">
                    &ldquo;{active.reason}&rdquo;
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-[var(--kia-text-soft)]">
                    {active.requestedByName} · {absolute(active.createdAt)}
                  </p>
                </div>

                {/* Zone 3 — THE COST. Amber is semantic: this is the reason to hesitate. */}
                {active.competingCount > 0 ? (
                  <div className={cn(
                    'rounded-xl border px-4 py-3',
                    active.competingNewerCount > 0
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40'
                      : 'border-[var(--kia-hairline)]',
                  )}
                    style={active.competingNewerCount > 0 ? undefined : { background: 'var(--kia-surface-sunken)' }}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle aria-hidden className={cn(
                        'mt-px h-4 w-4 shrink-0',
                        active.competingNewerCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--kia-text-faint)]',
                      )} />
                      <p className={cn(
                        'text-xs font-bold leading-5',
                        active.competingNewerCount > 0 ? 'text-amber-900 dark:text-amber-200' : 'text-[var(--kia-text)]',
                      )}>
                        {active.competingCount} other booking{active.competingCount === 1 ? '' : 's'} want this exact car
                        {active.competingNewerCount > 0 && (
                          <span className="block font-semibold">
                            {active.competingNewerCount} booked after it was allotted — granting time keeps them waiting
                          </span>
                        )}
                      </p>
                    </div>
                    <ul className={cn(
                      'mt-2.5 divide-y',
                      active.competingNewerCount > 0 ? 'divide-amber-200/70 dark:divide-amber-800/40' : 'divide-[var(--kia-hairline)]',
                    )}>
                      {active.competingBookings.map((c) => (
                        <li key={c.bookingId} className="flex items-center gap-2 py-1.5 text-xs">
                          <span className={cn(
                            'min-w-0 flex-1 truncate font-semibold',
                            active.competingNewerCount > 0 ? 'text-amber-900 dark:text-amber-200' : 'text-[var(--kia-text)]',
                          )}>
                            {c.customerName || '—'}
                          </span>
                          {/* 9px text needs 4.5:1, and amber-600 cannot carry light type — white on
                              it is 3.19:1, amber-50 on it 3.07:1. Light mode goes darker
                              (white on amber-700 = 5.02:1); dark mode inverts instead of chasing a
                              darker amber that would vanish into the amber-950 ground
                              (amber-950 on amber-400 = 8.97:1). */}
                          {c.isNewerThanAllocation && (
                            <span className="shrink-0 rounded bg-amber-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white dark:bg-amber-400 dark:text-amber-950">
                              newer
                            </span>
                          )}
                          {!c.sameDealer && (
                            <span
                              className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--kia-text-soft)]"
                              style={{ background: 'var(--kia-surface)', borderColor: 'var(--kia-hairline-strong)' }}
                            >
                              {c.dealerCode || 'other outlet'}
                            </span>
                          )}
                          <When
                            value={c.createdAt}
                            className={cn('shrink-0 text-[10px] font-medium', active.competingNewerCount > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-[var(--kia-text-soft)]')}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    No other booking wants this car.
                  </p>
                )}

                <div className="flex flex-wrap items-end gap-3 border-t pt-4" style={{ borderColor: 'var(--kia-hairline)' }}>
                  <label className="shrink-0">
                    <span className="mb-1 block text-[11px] font-bold text-[var(--kia-text-soft)]">Grant</span>
                    <select
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className={cn(CONTROL_H, 'w-[7.5rem] cursor-pointer rounded-lg border px-2.5 text-xs font-semibold text-[var(--kia-text)]')}
                      style={{ background: 'var(--kia-surface)', borderColor: 'var(--kia-hairline-strong)' }}
                    >
                      {Array.from({ length: 15 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={String(d)}>{d} day{d === 1 ? '' : 's'}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[10rem] flex-1">
                    <span className="mb-1 block text-[11px] font-bold text-[var(--kia-text-soft)]">
                      Remarks <span className="font-normal text-[var(--kia-text-soft)]">— emailed to {active.requestedByName.split(' ')[0]}</span>
                    </span>
                    <Input
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className={cn(CONTROL_H, 'rounded-lg text-xs')}
                      style={{ background: 'var(--kia-surface)', borderColor: 'var(--kia-hairline-strong)' }}
                    />
                  </label>
                </div>

                <p className="text-[11px] leading-relaxed text-[var(--kia-text-soft)]">
                  {active.allocationStatus === 'transferring'
                    ? 'The window starts when the car reaches Free Stock.'
                    : 'Counted from now, and never earlier than the current deadline.'}
                </p>

                {error && (
                  <p role="alert" className="rounded-lg bg-rose-50 p-3 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 border-t px-5 py-3.5 sm:gap-2" style={{ borderColor: 'var(--kia-hairline)' }}>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(CONTROL_H, 'rounded-lg px-4 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40')}
                  style={{ borderColor: 'var(--kia-hairline-strong)', background: 'var(--kia-surface)' }}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: active.id, action: 'REJECT', remarks })}
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  className={cn(CONTROL_H, 'rounded-lg bg-[var(--dashboard-action-bg)] px-4 text-xs font-bold text-[var(--dashboard-action-fg)] hover:bg-[var(--dashboard-action-hover)]')}
                  disabled={action.isPending || !days}
                  onClick={() => action.mutate({ id: active.id, action: 'APPROVE', approvedDays: Number(days), remarks })}
                >
                  {action.isPending && <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Approve {days}d
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
