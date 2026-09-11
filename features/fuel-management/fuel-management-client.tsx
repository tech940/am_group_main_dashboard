'use client'

import { useMemo, useState, type FC, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  CircleCheck,
  Fuel,
  Gauge,
  Hourglass,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatIndiaDate, formatIndiaDateTime, getIndiaYmd } from '@/lib/date-time'
import { getGatePassStatusInfo, type GatePassStatusInfo } from '@/lib/gate-pass/status'
import { cn } from '@/lib/utils'

/*
 * Fuel Management — operate-mode screen over GET /api/fuel-management.
 *
 * Honesty rules this screen keeps (each one replaced a defect):
 * - A failed load is an error panel with the server's message and a retry. It NEVER renders zeros,
 *   because zero litres and "could not load" must not look the same.
 * - km/L is shown only when the server could compute it from two fills with odometer readings; every
 *   other car shows the server's note instead. No efficiency labels, no thresholds, no cost.
 * - The period line comes from the RESPONSE (data.period), not the filter state, so while a new
 *   period loads the figures on screen are never labelled with dates they do not cover.
 *
 * Styling rules:
 * - Warning/info/status tones are inline hex (TONE), not Tailwind classes — app/globals.css retints
 *   emerald/amber/rose/green/red/yellow/orange utilities with !important. Same approach as
 *   features/gate-pass/fleet-panel.tsx STATE_STYLE.
 * - Tables carry `fuel-approvals-clean-table`: the global `thead tr`/`th` rules are element selectors
 *   with !important, so only an opt-out declared in globals.css can quieten a header. This one is the
 *   sibling Fuel Approvals screen's, which keeps the two fuel screens looking alike.
 * - Body rows use <td> only: the global `th` rule (white, uppercase, 900) would hit a body <th> too.
 * - fetch uses cache: 'no-store' — components/providers/query-provider.tsx patches window.fetch to
 *   cache GET /api/* for 30 minutes otherwise.
 */

// ── API contract (mirror of FuelManagementResponse in lib/fuel-management/types.ts) ────────────

type Branch = 'ALL' | 'JK402' | 'JK501'

type CheckKind =
  | 'odometer_backwards'
  | 'gate_odometer_mismatch'
  | 'possible_duplicate'
  | 'unmatched_demo_fill'
  | 'missing_odometer'

type FuelManagementResponse = {
  period: { from: string; to: string; branch: Branch }
  kpis: {
    approvedLitres: number
    approvedRequests: number
    awaiting: { total: number; byStage: { stage: string; label: string; count: number }[] }
    demoDriveKm: number
    demoDrives: number
    gpsVerifiedKm: number
    gpsVerifiedDrives: number
    checksNeedingAttention: number
  }
  byPurpose: {
    purpose: string
    label: string
    approvedLitres: number
    approvedRequests: number
    awaitingRequests: number
  }[]
  demoCars: {
    vin: string
    registrationNumber: string | null
    model: string | null
    branchLabel: string
    approvedLitres: number
    lastFillDate: string | null
    lastFillOdometerKm: number | null
    kmSinceLastFill: number | null
    kmPerLitre: { value: number; fillsUsed: number } | null
    kmPerLitreNote: string | null
    driveKm: number
    gpsKm: number
    fills: {
      requestNumber: string
      date: string
      litres: number
      odometerKm: number | null
      status: string
      statusLabel: string
    }[]
    drives: {
      passNo: string
      gateOutAt: string
      status: string
      odometerKm: number | null
      gpsKm: number | null
    }[]
  }[]
  otherFuel: {
    requestNumber: string
    date: string
    purpose: string
    purposeLabel: string
    vehicleLabel: string
    branchLabel: string
    litres: number
    status: string
    statusLabel: string
  }[]
  checks: {
    kind: CheckKind
    severity: 'warning' | 'info'
    requestNumber: string
    vin: string | null
    vehicleLabel: string
    message: string
  }[]
  generatedAt: string
}

type DemoCar = FuelManagementResponse['demoCars'][number]
type FuelCheck = FuelManagementResponse['checks'][number]

// ── Constants ──────────────────────────────────────────────────────────────────────────────────

type PeriodPreset = 'month' | 'last30' | 'custom'

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
]

const BRANCH_OPTIONS: { value: Branch; label: string }[] = [
  { value: 'ALL', label: 'All branches' },
  { value: 'JK402', label: 'Jammu' },
  { value: 'JK501', label: 'Udhampur' },
]

const BRANCH_LABEL: Record<Branch, string> = {
  ALL: 'All branches',
  JK402: 'Jammu',
  JK501: 'Udhampur',
}

/** Same ceiling the API enforces; checked here so the user gets a sentence, not a 400. */
const MAX_PERIOD_DAYS = 366

/** Checks shown before "Show all". Keeps warnings in view without a wall of notes on a phone. */
const CHECKS_PREVIEW_COUNT = 6

const TONE = {
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  info: { bg: '#eef2ff', fg: '#3730a3', border: '#c7d2fe' },
  success: { bg: '#d1fae5', fg: '#065f46', border: '#a7f3d0' },
  danger: { bg: '#ffe4e6', fg: '#9f1239', border: '#fecdd3' },
  muted: { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' },
} as const

type Tone = keyof typeof TONE

const CHECK_TITLE: Record<CheckKind, string> = {
  odometer_backwards: 'Odometer reading went backwards',
  gate_odometer_mismatch: 'Fill odometer is below an earlier gate-in reading',
  possible_duplicate: 'Possible duplicate request',
  unmatched_demo_fill: 'Demo fill not linked to a demo car',
  missing_odometer: 'Demo fill has no odometer reading',
}

const GATE_PASS_TONE: Record<GatePassStatusInfo['tone'], Tone> = {
  pending: 'warning',
  success: 'success',
  danger: 'danger',
  active: 'info',
  muted: 'muted',
}

const litresFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const kmFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────

function formatLitres(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? litresFormat.format(value) : '—'
}

function formatKm(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? kmFormat.format(value) : '—'
}

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? countFormat.format(value) : '—'
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Civil-date marker at UTC midnight. Only for calendar arithmetic on 'YYYY-MM-DD' — never an instant. */
function ymdToUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`)
}

/** True for a real calendar day in 'YYYY-MM-DD' (rejects 2026-02-30, which Date would roll over). */
function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = ymdToUtcMs(value)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

function shiftYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * A 'YYYY-MM-DD' calendar day in the app's house date format ('07 Sept 2026').
 *
 * Anchored at IST midnight and rendered by the shared IST formatters, so a DATE column reads exactly
 * like the gate-out timestamps beside it (formatIndiaDateTime) and like every other screen — a
 * hand-rolled month table said 'Sep' where the app says 'Sept'. The explicit +05:30 anchor keeps the
 * day from shifting in any viewer's timezone.
 */
function formatYmd(value: string | null | undefined, withYear = true): string {
  const ymd = String(value ?? '').slice(0, 10)
  if (!isValidYmd(ymd)) return '—'
  const istMidnight = `${ymd}T00:00:00+05:30`
  return withYear
    ? formatIndiaDate(istMidnight)
    : formatIndiaDateTime(istMidnight, { hour: undefined, minute: undefined, hour12: undefined }) ?? '—'
}

function formatRange(from: string, to: string): string {
  if (from === to) return formatYmd(from)
  if (from.slice(0, 4) === to.slice(0, 4)) return `${formatYmd(from, false)} – ${formatYmd(to)}`
  return `${formatYmd(from)} – ${formatYmd(to)}`
}

function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string) {
  return preset === 'month'
    ? { from: `${today.slice(0, 8)}01`, to: today }
    : { from: shiftYmd(today, -29), to: today }
}

type RangeResult = { range: { from: string; to: string }; error: null } | { range: null; error: string }

function validateCustomRange(from: string, to: string): RangeResult {
  if (!from || !to) return { range: null, error: 'Pick both a start date and an end date.' }
  if (!isValidYmd(from) || !isValidYmd(to)) return { range: null, error: 'One of the dates is not a real calendar day.' }
  if (from > to) return { range: null, error: 'The start date needs to be on or before the end date.' }
  const days = (ymdToUtcMs(to) - ymdToUtcMs(from)) / 86_400_000 + 1
  if (days > MAX_PERIOD_DAYS) return { range: null, error: 'Choose a period of one year or less.' }
  return { range: { from, to }, error: null }
}

function fuelStatusTone(status: string): Tone {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'sent_back' || status.endsWith('_on_hold')) return 'warning'
  return 'info'
}

function vinTail(vin: string | null | undefined): string | null {
  const clean = String(vin ?? '').trim()
  return clean ? `VIN …${clean.slice(-6)}` : null
}

function isEmptyPeriod(data: FuelManagementResponse): boolean {
  return (
    data.kpis.approvedRequests === 0 &&
    data.kpis.awaiting.total === 0 &&
    data.kpis.demoDrives === 0 &&
    data.byPurpose.length === 0 &&
    data.demoCars.length === 0 &&
    data.otherFuel.length === 0 &&
    data.checks.length === 0
  )
}

// ── Loading ────────────────────────────────────────────────────────────────────────────────────

class FuelManagementLoadError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'FuelManagementLoadError'
    this.status = status
  }
}

async function loadFuelManagement(from: string, to: string, branch: Branch): Promise<FuelManagementResponse> {
  const params = new URLSearchParams({ from, to, branch })
  let res: Response
  try {
    res = await fetch(`/api/fuel-management?${params.toString()}`, { cache: 'no-store' })
  } catch {
    throw new FuelManagementLoadError('Could not reach the server. Check your connection and try again.', 0)
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new FuelManagementLoadError('Your session has ended. Sign in again to see fuel figures.', 401)
    }
    if (res.status === 403) {
      throw new FuelManagementLoadError("Your account can't open Fuel Management.", 403)
    }
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null
    const serverMessage = typeof body?.error === 'string' ? body.error.trim() : ''
    throw new FuelManagementLoadError(
      serverMessage || 'Fuel figures could not be loaded. Try again in a moment.',
      res.status,
    )
  }

  const payload = (await res.json().catch(() => null)) as FuelManagementResponse | null
  if (!payload || typeof payload !== 'object' || !payload.kpis || !payload.period) {
    throw new FuelManagementLoadError('The server sent a response this screen could not read. Try again.', res.status)
  }
  return payload
}

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────

interface FuelManagementClientProps {
  /** Accepted for compatibility with app/fuel-management/page.tsx; the screen needs nothing from it. */
  currentUser?: Record<string, unknown>
}

export const FuelManagementClient: FC<FuelManagementClientProps> = () => {
  const [today] = useState(() => getIndiaYmd())
  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [branch, setBranch] = useState<Branch>('ALL')
  const [expandedVins, setExpandedVins] = useState<ReadonlySet<string>>(() => new Set())
  const [showAllChecks, setShowAllChecks] = useState(false)

  const rangeResult: RangeResult = useMemo(
    () =>
      preset === 'custom'
        ? validateCustomRange(customFrom, customTo)
        : { range: presetRange(preset, today), error: null },
    [preset, customFrom, customTo, today],
  )
  const range = rangeResult.range

  const query = useQuery({
    queryKey: ['fuel-management', range?.from ?? null, range?.to ?? null, branch],
    queryFn: () =>
      range
        ? loadFuelManagement(range.from, range.to, branch)
        : Promise.reject(new FuelManagementLoadError('Choose a valid period first.', 400)),
    enabled: range !== null,
    placeholderData: keepPreviousData,
    // The app-wide default is a 30-minute stale time with no refetch on mount; fuel requests are
    // approved through the day, so coming back to this screen should show the current position.
    staleTime: 60_000,
    refetchOnMount: true,
    // One retry for a dropped connection or a server hiccup; never for a 4xx, which will not change.
    retry: (failureCount, error) =>
      failureCount < 1 &&
      error instanceof FuelManagementLoadError &&
      (error.status === 0 || error.status >= 500),
  })

  const { data, error, isError, isFetching, isPlaceholderData, refetch } = query
  const loadError = error instanceof FuelManagementLoadError ? error : null

  const selectPreset = (next: PeriodPreset) => {
    if (next === 'custom' && preset !== 'custom') {
      // Start the custom range from what is on screen, so switching is never an empty, invalid state.
      const current = presetRange(preset, today)
      setCustomFrom(current.from)
      setCustomTo(current.to)
    }
    setPreset(next)
  }

  const toggleCar = (vin: string) => {
    setExpandedVins((prev) => {
      const next = new Set(prev)
      if (next.has(vin)) next.delete(vin)
      else next.add(vin)
      return next
    })
  }

  let statusLine: ReactNode
  if (range === null) {
    statusLine = <span style={{ color: TONE.warning.fg }}>{rangeResult.error}</span>
  } else if (isFetching && (!data || isPlaceholderData)) {
    statusLine = `Loading ${formatRange(range.from, range.to)} · ${BRANCH_LABEL[branch]}…`
  } else if (data) {
    const updated = formatIndiaDateTime(data.generatedAt, { day: undefined, month: undefined })
    statusLine = (
      <>
        Showing <span className="font-medium text-slate-700">{formatRange(data.period.from, data.period.to)}</span>
        {' · '}
        {BRANCH_LABEL[data.period.branch] ?? data.period.branch}
        {updated ? ` · Updated ${updated} IST` : ''}
      </>
    )
  } else {
    statusLine = null
  }

  let body: ReactNode
  if (range === null) {
    body = (
      <StatePanel icon={<Hourglass className="h-5 w-5" aria-hidden />} title="Choose a period to see fuel figures">
        Fix the dates above and the figures load on their own.
      </StatePanel>
    )
  } else if (!data && isError) {
    if (loadError?.status === 403) {
      body = (
        <StatePanel icon={<ShieldAlert className="h-5 w-5" aria-hidden />} title="You don't have access to Fuel Management">
          If you need these figures, ask an administrator to give your account access.
        </StatePanel>
      )
    } else if (loadError?.status === 401) {
      body = (
        <StatePanel
          icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
          title="Your session has ended"
          action={
            <a
              href="/auth/login"
              className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Sign in again
            </a>
          }
        >
          Sign in again to see fuel figures.
        </StatePanel>
      )
    } else {
      body = (
        <StatePanel
          role="alert"
          tone="warning"
          icon={<TriangleAlert className="h-5 w-5" aria-hidden />}
          title="Couldn't load fuel figures"
          action={<RetryButton onRetry={() => void refetch()} busy={isFetching} />}
        >
          {error?.message || 'Fuel figures could not be loaded. Try again in a moment.'}
        </StatePanel>
      )
    }
  } else if (!data) {
    body = <LoadingSkeleton />
  } else if (isEmptyPeriod(data)) {
    body = (
      <StatePanel icon={<Fuel className="h-5 w-5" aria-hidden />} title="Nothing recorded in this period">
        No fuel requests or demo drives for {formatRange(data.period.from, data.period.to)}
        {data.period.branch === 'ALL' ? '' : ` at ${BRANCH_LABEL[data.period.branch]}`}. Try a longer period
        {data.period.branch === 'ALL' ? '' : ' or all branches'}.
      </StatePanel>
    )
  } else {
    body = (
      <div
        className={cn('space-y-4 motion-safe:transition-opacity', isPlaceholderData && 'opacity-60')}
        aria-busy={isPlaceholderData || undefined}
      >
        {isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm"
            style={{ backgroundColor: TONE.warning.bg, borderColor: TONE.warning.border, color: TONE.warning.fg }}
          >
            <span>
              Couldn&apos;t refresh: {error?.message || 'the server did not answer.'} These are the figures from the last
              successful load.
            </span>
            <RetryButton onRetry={() => void refetch()} busy={isFetching} />
          </div>
        ) : null}

        <KpiRow data={data} />

        <div className="grid items-start gap-4 lg:grid-cols-5">
          <ChecksSection
            className="lg:col-span-3"
            checks={data.checks}
            showAll={showAllChecks}
            onToggleShowAll={() => setShowAllChecks((v) => !v)}
          />
          <PurposeSection className="lg:col-span-2" rows={data.byPurpose} />
        </div>

        <DemoCarsSection cars={data.demoCars} expandedVins={expandedVins} onToggle={toggleCar} />

        <OtherFuelSection rows={data.otherFuel} />
      </div>
    )
  }

  return (
    <MainLayout title="Fuel Management" subtitle="Fuel approved, demo drives, and the records that need a look">
      <div className="mx-auto max-w-[1600px] space-y-4 pb-12">
        <section aria-label="Filters" className="rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <FilterGroup id="fm-period" label="Period">
                <Segmented labelledBy="fm-period" value={preset} options={PERIOD_OPTIONS} onChange={selectPreset} />
              </FilterGroup>

              {preset === 'custom' ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fm-from" className="text-[11px] font-semibold text-slate-500">
                      From
                    </Label>
                    <Input
                      id="fm-from"
                      type="date"
                      value={customFrom}
                      max={customTo || undefined}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      aria-invalid={range === null}
                      aria-describedby="fm-status"
                      className="h-9 w-[10rem] rounded-lg border-slate-200 bg-white text-xs tabular-nums"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fm-to" className="text-[11px] font-semibold text-slate-500">
                      To
                    </Label>
                    <Input
                      id="fm-to"
                      type="date"
                      value={customTo}
                      min={customFrom || undefined}
                      onChange={(e) => setCustomTo(e.target.value)}
                      aria-invalid={range === null}
                      aria-describedby="fm-status"
                      className="h-9 w-[10rem] rounded-lg border-slate-200 bg-white text-xs tabular-nums"
                    />
                  </div>
                </div>
              ) : null}

              <FilterGroup id="fm-branch" label="Branch">
                <Segmented labelledBy="fm-branch" value={branch} options={BRANCH_OPTIONS} onChange={setBranch} />
              </FilterGroup>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={range === null || isFetching}
              className="h-9 self-start rounded-lg text-xs font-semibold lg:self-auto"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'motion-safe:animate-spin')} aria-hidden />
              {isFetching ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
          <p
            id="fm-status"
            aria-live="polite"
            className="min-h-[2.25rem] border-t border-slate-100 px-3 py-2 text-xs text-slate-500 tabular-nums sm:px-4"
          >
            {statusLine}
          </p>
        </section>

        {body}
      </div>
    </MainLayout>
  )
}

// ── Filter controls ────────────────────────────────────────────────────────────────────────────

function FilterGroup({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[11px] font-semibold text-slate-500">
        {label}
      </span>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
              active ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function RetryButton({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={busy} className="h-9 rounded-lg text-xs font-semibold">
      {busy ? (
        <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      )}
      {busy ? 'Trying again' : 'Try again'}
    </Button>
  )
}

// ── States ─────────────────────────────────────────────────────────────────────────────────────

function StatePanel({
  icon,
  title,
  children,
  action,
  role,
  tone = 'muted',
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
  role?: 'alert' | 'status'
  tone?: Tone
}) {
  return (
    <div role={role} className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-xs">
      <div
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: TONE[tone].bg, color: TONE[tone].fg }}
      >
        {icon}
      </div>
      <h2 className="mt-3 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <p role="status" className="sr-only">
        Loading fuel figures…
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="h-3 w-24 rounded bg-slate-100 motion-safe:animate-pulse" />
            <div className="mt-3 h-7 w-20 rounded bg-slate-100 motion-safe:animate-pulse" />
            <div className="mt-3 h-3 w-40 rounded bg-slate-100 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="h-56 rounded-2xl border border-slate-200 bg-white motion-safe:animate-pulse lg:col-span-3" />
        <div className="h-56 rounded-2xl border border-slate-200 bg-white motion-safe:animate-pulse lg:col-span-2" />
      </div>
      <div className="h-72 rounded-2xl border border-slate-200 bg-white motion-safe:animate-pulse" />
    </div>
  )
}

// ── KPI row ────────────────────────────────────────────────────────────────────────────────────

function KpiTile({
  icon,
  label,
  value,
  unit,
  valueTone,
  children,
}: {
  icon: ReactNode
  label: string
  value: string
  unit: string
  valueTone?: Tone
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span
          className="text-2xl font-semibold tabular-nums text-slate-900"
          style={valueTone ? { color: TONE[valueTone].fg } : undefined}
        >
          {value}
        </span>
        <span className="text-sm font-medium text-slate-500">{unit}</span>
      </p>
      <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-slate-500">{children}</div>
    </div>
  )
}

function KpiRow({ data }: { data: FuelManagementResponse }) {
  const { kpis } = data
  const warnings = kpis.checksNeedingAttention
  const notes = data.checks.filter((c) => c.severity === 'info').length
  const iconClass = 'h-4 w-4 text-slate-400'

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile icon={<Fuel className={iconClass} aria-hidden />} label="Fuel approved" value={formatLitres(kpis.approvedLitres)} unit="L">
        <p>
          {formatCount(kpis.approvedRequests)} approved {plural(kpis.approvedRequests, 'request', 'requests')}, every
          purpose.
        </p>
      </KpiTile>

      <KpiTile
        icon={<Hourglass className={iconClass} aria-hidden />}
        label="Awaiting approval"
        value={formatCount(kpis.awaiting.total)}
        unit={plural(kpis.awaiting.total, 'request', 'requests')}
      >
        {kpis.awaiting.total === 0 ? (
          <p>Nothing is waiting for a decision.</p>
        ) : (
          <>
            <p className="tabular-nums">
              Waiting on{' '}
              {kpis.awaiting.byStage.map((s, i) => (
                <span key={s.stage}>
                  {i > 0 ? ' · ' : ''}
                  <span className="font-medium text-slate-700">{s.label}</span> {formatCount(s.count)}
                </span>
              ))}
            </p>
            <p>Not counted in fuel approved.</p>
          </>
        )}
      </KpiTile>

      <KpiTile icon={<Gauge className={iconClass} aria-hidden />} label="Demo drive distance" value={formatKm(kpis.demoDriveKm)} unit="km">
        <p>
          Gate-in minus gate-out odometer on {formatCount(kpis.demoDrives)} returned{' '}
          {plural(kpis.demoDrives, 'drive', 'drives')}.
        </p>
        <p>
          {kpis.gpsVerifiedDrives > 0
            ? `GPS-verified: ${formatKm(kpis.gpsVerifiedKm)} km on ${formatCount(kpis.gpsVerifiedDrives)} ${plural(kpis.gpsVerifiedDrives, 'drive', 'drives')}.`
            : 'No drive in this period has a GPS-verified distance yet.'}
        </p>
      </KpiTile>

      <KpiTile
        icon={<TriangleAlert className={iconClass} aria-hidden />}
        label="Needs a look"
        value={formatCount(warnings)}
        unit={plural(warnings, 'warning', 'warnings')}
        valueTone={warnings > 0 ? 'warning' : undefined}
      >
        <p>
          {warnings > 0
            ? "Records whose numbers don't add up."
            : notes > 0
              ? 'No warnings in this period.'
              : 'Nothing in this period looks inconsistent.'}
        </p>
        {notes > 0 ? (
          <p>
            Plus {formatCount(notes)} {plural(notes, 'note', 'notes')} about records the screen could not use.
          </p>
        ) : null}
      </KpiTile>
    </div>
  )
}

// ── Needs a look ───────────────────────────────────────────────────────────────────────────────

function ChecksSection({
  checks,
  showAll,
  onToggleShowAll,
  className,
}: {
  checks: FuelCheck[]
  showAll: boolean
  onToggleShowAll: () => void
  className?: string
}) {
  // Warnings first, then notes; server order within each group (Array.prototype.sort is stable).
  const sorted = useMemo(
    () => [...checks].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1)),
    [checks],
  )
  const warnings = sorted.filter((c) => c.severity === 'warning').length
  const notes = sorted.length - warnings
  const visible = showAll ? sorted : sorted.slice(0, CHECKS_PREVIEW_COUNT)
  const hiddenCount = sorted.length - visible.length

  return (
    <section aria-labelledby="fm-checks-heading" className={cn('rounded-2xl border border-slate-200 bg-white shadow-xs', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 id="fm-checks-heading" className="text-sm font-semibold text-slate-900">
          Needs a look
        </h2>
        {sorted.length > 0 ? (
          <p className="text-xs text-slate-500 tabular-nums">
            {formatCount(warnings)} {plural(warnings, 'warning', 'warnings')} · {formatCount(notes)}{' '}
            {plural(notes, 'note', 'notes')}
          </p>
        ) : null}
      </header>

      {sorted.length === 0 ? (
        <div className="flex items-start gap-3 px-4 py-6">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: TONE.success.bg, color: TONE.success.fg }}
            aria-hidden
          >
            <CircleCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-slate-900">All clear</p>
            <p className="text-sm text-slate-600">
              No odometer, gate pass or duplicate problems in this period, and every demo fill is linked to a car.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul id="fm-checks-list" className="divide-y divide-slate-100">
            {visible.map((check, index) => (
              <CheckItem key={`${check.kind}-${check.requestNumber}-${index}`} check={check} />
            ))}
          </ul>
          {sorted.length > CHECKS_PREVIEW_COUNT ? (
            <div className="border-t border-slate-100 px-4 py-2">
              <button
                type="button"
                aria-expanded={showAll}
                aria-controls="fm-checks-list"
                onClick={onToggleShowAll}
                className="rounded-md px-1 py-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
              >
                {showAll ? 'Show fewer' : `Show all ${formatCount(sorted.length)} (${formatCount(hiddenCount)} more)`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function CheckItem({ check }: { check: FuelCheck }) {
  const tone = TONE[check.severity === 'warning' ? 'warning' : 'info']
  const tail = vinTail(check.vin)
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: tone.bg, color: tone.fg }}
        aria-hidden
      >
        {check.severity === 'warning' ? <TriangleAlert className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-900">{CHECK_TITLE[check.kind] ?? 'Check this record'}</span>
          <span
            className="rounded-full border px-2 py-px text-[11px] font-semibold"
            style={{ backgroundColor: tone.bg, color: tone.fg, borderColor: tone.border }}
          >
            {check.severity === 'warning' ? 'Warning' : 'Note'}
          </span>
        </p>
        <p className="mt-0.5 text-sm text-slate-600">{check.message}</p>
        <p className="mt-1 break-words text-xs text-slate-500">
          <span className="font-mono text-slate-700">{check.requestNumber}</span>
          {check.vehicleLabel ? ` · ${check.vehicleLabel}` : ''}
          {tail ? ` · ${tail}` : ''}
        </p>
      </div>
    </li>
  )
}

// ── Fuel by purpose ────────────────────────────────────────────────────────────────────────────

function PurposeSection({ rows, className }: { rows: FuelManagementResponse['byPurpose']; className?: string }) {
  const maxLitres = rows.reduce((max, r) => Math.max(max, Number.isFinite(r.approvedLitres) ? r.approvedLitres : 0), 0)

  return (
    <section aria-labelledby="fm-purpose-heading" className={cn('rounded-2xl border border-slate-200 bg-white shadow-xs', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 id="fm-purpose-heading" className="text-sm font-semibold text-slate-900">
          Fuel by purpose
        </h2>
        <p className="text-xs text-slate-500">Approved litres in this period</p>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-600">No fuel requests in this period.</p>
      ) : (
        <ul className="space-y-4 px-4 py-4">
          {rows.map((row) => {
            const share = maxLitres > 0 ? Math.max(0, row.approvedLitres) / maxLitres : 0
            return (
              <li key={row.purpose}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words font-medium text-slate-800">{row.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">{formatLitres(row.approvedLitres)} L</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  {share > 0 ? (
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${Math.max(2, share * 100)}%`, backgroundColor: 'var(--dashboard-primary)' }}
                    />
                  ) : null}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                  <span>
                    {formatCount(row.approvedRequests)} approved
                  </span>
                  {row.awaitingRequests > 0 ? (
                    <span
                      className="rounded-full border px-2 py-px text-[11px] font-semibold"
                      style={{ backgroundColor: TONE.info.bg, color: TONE.info.fg, borderColor: TONE.info.border }}
                    >
                      {formatCount(row.awaitingRequests)} awaiting
                    </span>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Demo cars ──────────────────────────────────────────────────────────────────────────────────

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const t = TONE[tone]
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
    >
      {label}
    </span>
  )
}

function DemoCarsSection({
  cars,
  expandedVins,
  onToggle,
}: {
  cars: DemoCar[]
  expandedVins: ReadonlySet<string>
  onToggle: (vin: string) => void
}) {
  return (
    <section aria-labelledby="fm-cars-heading" className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 id="fm-cars-heading" className="text-sm font-semibold text-slate-900">
          Demo cars
        </h2>
        <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">
          A fill counts towards a car only when the request names exactly one demo car, by plate or VIN. km per litre
          uses the odometer readings at two fills — not drive distance, because fuel also covers driving that isn&apos;t
          a demo.
        </p>
      </header>

      {cars.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-600">No demo car had a linked fill or a drive in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fuel-approvals-clean-table w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left">Car</th>
                <th scope="col" className="px-4 py-2.5 text-right">Fuel approved</th>
                <th scope="col" className="px-4 py-2.5 text-right">Odometer at last fill</th>
                <th scope="col" className="px-4 py-2.5 text-right">Since last fill</th>
                <th scope="col" className="px-4 py-2.5 text-right">Drives</th>
                <th scope="col" className="px-4 py-2.5 text-left">km per litre</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car) => (
                <DemoCarRows key={car.vin} car={car} expanded={expandedVins.has(car.vin)} onToggle={() => onToggle(car.vin)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function DemoCarRows({ car, expanded, onToggle }: { car: DemoCar; expanded: boolean; onToggle: () => void }) {
  const detailId = `fm-car-detail-${car.vin.replace(/[^A-Za-z0-9_-]/g, '')}`
  const approvedFills = car.fills.filter((f) => f.status === 'approved').length
  const awaitingFills = car.fills.length - approvedFills
  const backwards = Boolean(car.kmPerLitreNote && car.kmPerLitreNote.toLowerCase().includes('backwards'))
  const subLine = [car.model, vinTail(car.vin), car.branchLabel].filter(Boolean).join(' · ')

  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="px-4 py-3">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={onToggle}
            className="flex w-full items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <ChevronRight
              className={cn('mt-0.5 h-4 w-4 shrink-0 text-slate-400 motion-safe:transition-transform', expanded && 'rotate-90')}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block font-semibold text-slate-900">{car.registrationNumber || 'No registration'}</span>
              <span className="block text-xs text-slate-500">{subLine}</span>
              <span className="sr-only"> — fills and drives</span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <span className="font-semibold text-slate-900">{formatLitres(car.approvedLitres)} L</span>
          <span className="block text-xs text-slate-500">
            {formatCount(approvedFills)} approved {plural(approvedFills, 'fill', 'fills')}
            {awaitingFills > 0 ? ` · ${formatCount(awaitingFills)} awaiting` : ''}
          </span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {car.lastFillDate ? (
            <>
              <span className="font-semibold text-slate-900">
                {car.lastFillOdometerKm !== null ? `${formatKm(car.lastFillOdometerKm)} km` : 'No reading'}
              </span>
              <span className="block text-xs text-slate-500">{formatYmd(car.lastFillDate)}</span>
            </>
          ) : (
            <>
              <span className="text-slate-400">—</span>
              <span className="block text-xs text-slate-500">No approved fill</span>
            </>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {car.kmSinceLastFill !== null ? (
            <>
              <span className="font-semibold text-slate-900">{formatKm(car.kmSinceLastFill)} km</span>
              <span className="block text-xs text-slate-500">To the latest return</span>
            </>
          ) : (
            <>
              <span className="text-slate-400">—</span>
              <span className="block text-xs text-slate-500">Not enough readings</span>
            </>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {car.drives.length > 0 ? (
            <>
              <span className="font-semibold text-slate-900">
                {formatCount(car.drives.length)} · {formatKm(car.driveKm)} km
              </span>
              <span className="block text-xs text-slate-500">
                {car.gpsKm > 0 ? `GPS-verified ${formatKm(car.gpsKm)} km` : 'None GPS-verified'}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-500">No drives</span>
          )}
        </td>
        <td className="px-4 py-3">
          {car.kmPerLitre ? (
            <>
              <span className="font-semibold tabular-nums text-slate-900">{formatKm(car.kmPerLitre.value)} km/L</span>
              <span className="block text-xs text-slate-500">
                From {formatCount(car.kmPerLitre.fillsUsed)} fills
              </span>
            </>
          ) : (
            <span
              className="block max-w-[15rem] text-xs leading-relaxed text-slate-600"
              style={backwards ? { color: TONE.warning.fg } : undefined}
            >
              {car.kmPerLitreNote || 'Needs a second fill with an odometer reading.'}
            </span>
          )}
        </td>
      </tr>
      <tr id={detailId} hidden={!expanded} className="border-b border-slate-100">
        <td colSpan={6} className="bg-slate-50 px-4 pb-4 pt-2">
          {/* Sticky + viewport-capped so, on a phone, the detail stays in view while the wide parent
              table scrolls sideways; each inner table scrolls on its own. */}
          <div className="sticky left-4 max-w-[calc(100vw-5rem)] lg:max-w-none">
            <CarDetail car={car} />
          </div>
        </td>
      </tr>
    </>
  )
}

function CarDetail({ car }: { car: DemoCar }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-slate-700">Fuel fills</h3>
          {car.fills.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No fill linked to this car in the period.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="fuel-approvals-clean-table w-full min-w-[440px] text-left text-xs">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Date</th>
                    <th scope="col" className="px-3 py-2 text-left">Request</th>
                    <th scope="col" className="px-3 py-2 text-right">Litres</th>
                    <th scope="col" className="px-3 py-2 text-right">Odometer</th>
                    <th scope="col" className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {car.fills.map((fill, index) => (
                    <tr key={`${fill.requestNumber}-${index}`}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{formatYmd(fill.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{fill.requestNumber}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatLitres(fill.litres)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {fill.odometerKm !== null ? `${formatKm(fill.odometerKm)} km` : <span className="text-slate-400">No reading</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill label={fill.statusLabel} tone={fuelStatusTone(fill.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-slate-700">Demo drives</h3>
          {car.drives.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No gate pass for this car in the period.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="fuel-approvals-clean-table w-full min-w-[440px] text-left text-xs">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Gate out</th>
                    <th scope="col" className="px-3 py-2 text-left">Pass</th>
                    <th scope="col" className="px-3 py-2 text-right">Odometer</th>
                    <th scope="col" className="px-3 py-2 text-right">GPS</th>
                    <th scope="col" className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {car.drives.map((drive, index) => {
                    const info = getGatePassStatusInfo(drive.status)
                    return (
                      <tr key={`${drive.passNo}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">
                          {formatIndiaDateTime(drive.gateOutAt) ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{drive.passNo}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                          {drive.odometerKm !== null ? `${formatKm(drive.odometerKm)} km` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                          {drive.gpsKm !== null ? `${formatKm(drive.gpsKm)} km` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill label={info.pillLabel} tone={GATE_PASS_TONE[info.tone]} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        {car.kmPerLitre
          ? `km per litre: odometer gained between the first and last of ${formatCount(car.kmPerLitre.fillsUsed)} approved fills with readings, divided by the litres added after the first of them.`
          : `km per litre: ${car.kmPerLitreNote || 'Needs a second fill with an odometer reading.'}`}{' '}
        Odometer on a drive is gate-in minus gate-out; GPS is the tracker&apos;s distance where the trip was matched.
      </p>
    </div>
  )
}

// ── Other fuel ─────────────────────────────────────────────────────────────────────────────────

function OtherFuelSection({ rows }: { rows: FuelManagementResponse['otherFuel'] }) {
  return (
    <section aria-labelledby="fm-other-heading" className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 id="fm-other-heading" className="text-sm font-semibold text-slate-900">
          Other fuel
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Fuel requested for anything other than demo drives. These requests aren&apos;t linked to a demo car.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-600">No fuel for other purposes in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fuel-approvals-clean-table w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left">Date</th>
                <th scope="col" className="px-4 py-2.5 text-left">Request</th>
                <th scope="col" className="px-4 py-2.5 text-left">Purpose</th>
                <th scope="col" className="px-4 py-2.5 text-left">Vehicle</th>
                <th scope="col" className="px-4 py-2.5 text-left">Branch</th>
                <th scope="col" className="px-4 py-2.5 text-right">Litres</th>
                <th scope="col" className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => (
                <tr key={`${row.requestNumber}-${index}`} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-700">{formatYmd(row.date)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-700">{row.requestNumber}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{row.purposeLabel}</td>
                  <td className="min-w-[12rem] max-w-[20rem] break-words px-4 py-2.5 text-slate-700">{row.vehicleLabel || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{row.branchLabel}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                    {formatLitres(row.litres)} L
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusPill label={row.statusLabel} tone={fuelStatusTone(row.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
