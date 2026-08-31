'use client'

import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronRight, Info, Search, X } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { InsuranceSegment } from '@/lib/insurance-360/lifecycle'

/**
 * INSURANCE 360 — the relationship behind every insured vehicle.
 *
 * ── Why a row is a VEHICLE ────────────────────────────────────────────────────────────────────
 * The brief asks for a customer-first table, and for Hyundai and Platinum the data cannot support
 * one: there is no phone on any insurance feed, the sales VIN is masked at source so the party-key
 * bridge returns zero matches, and customer NAME is not an identifier — "RAKESH KUMAR" spans 81
 * distinct chassis. A person-keyed table would merge strangers into one history.
 *
 * So the row is the vehicle and its policy chain, with the owner shown AS RECORDED on the latest
 * policy. That is the honest unit, and it still answers the question the brief actually asks:
 * what is the whole insurance relationship, and is it continuous.
 *
 * ── Design ────────────────────────────────────────────────────────────────────────────────────
 * Dense enterprise table, subtle separators, small status indicators, one horizontal journey per
 * record. No gradients, no glass, no giant KPI cards — the brief rules those out and this section
 * already suffers from an off-palette teal treatment that fights the rest of the product.
 */

type Journey = {
  sequence: number
  policyNo: string | null
  startDate: string | null
  expiryDate: string | null
  eventType: 'NEW' | 'RENEWAL' | 'ROLLOVER' | 'UNKNOWN'
  insurer: string | null
  grossPremium: number | null
  gapDays: number | null
  brokeCover: boolean
  active: boolean
}

type Row = {
  chassisNo: string
  customerName: string | null
  registration: string | null
  model: string | null
  dealerCode: string | null
  statusLabel: string
  segments: InsuranceSegment[]
  relationship: {
    journey: Journey[]
    policyCount: number
    rowCount: number
    firstPolicyDate: string | null
    latestExpiryDate: string | null
    status: string
    daysToExpiry: number | null
    renewalCount: number
    rolloverCount: number
    neverLapsed: boolean
    longestGapDays: number | null
    yearsRetained: number | null
    leftCensored: boolean
    reviewReasons: string[]
  }
}

type Overview = {
  vehicles: number; policies: number; activeCover: number; dueForRenewal: number
  expired: number; lapsed: number; lost: number; neverLapsed: number; multiPolicy: number
  newPolicies: number; renewalPolicies: number; rolloverPolicies: number | null
  leftCensored: number; caveats: string[]
}

const BRANDS = [
  { id: 'hyundai', label: 'Hyundai' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'kia', label: 'Kia' },
] as const

const SEGMENT_LABEL: Record<InsuranceSegment, string> = {
  NEW: 'New', RENEWAL: 'Renewed', ROLLOVER: 'Rollover', RETAINED: 'Retained',
  NEVER_LAPSED: 'Never lapsed', LAPSED: 'Lapsed', LOST: 'Lost',
  DUE_FOR_RENEWAL: 'Due for renewal', EXPIRED: 'Expired', MULTI_POLICY: 'Multi-policy',
}

/** Status tone. Deliberately narrow: one neutral, one attention, one problem. */
const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  DUE_FOR_RENEWAL: 'text-amber-800 bg-amber-50 border-amber-200',
  EXPIRED: 'text-amber-800 bg-amber-50 border-amber-200',
  LAPSED: 'text-rose-700 bg-rose-50 border-rose-200',
  LOST: 'text-rose-700 bg-rose-50 border-rose-200',
  NO_COVER_ON_RECORD: 'text-slate-500 bg-slate-50 border-slate-200',
}

const EVENT_TONE: Record<Journey['eventType'], string> = {
  NEW: 'bg-indigo-600',
  RENEWAL: 'bg-slate-400',
  ROLLOVER: 'bg-indigo-400',
  UNKNOWN: 'bg-slate-300',
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const fmtYear = (iso: string | null) => (iso ? iso.slice(0, 4) : '—')
const num = (n: number) => n.toLocaleString('en-IN')

/* -------------------------------------------------------------------------- */

export function RelationshipsClient() {
  const [brand, setBrand] = useState<(typeof BRANDS)[number]['id']>('hyundai')
  const [segment, setSegment] = useState<InsuranceSegment | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [openChassis, setOpenChassis] = useState<string | null>(null)

  const overviewQuery = useQuery({
    queryKey: ['insurance-360', 'overview', brand],
    queryFn: async () => {
      const res = await fetch(`/api/insurance-360?brand=${brand}`)
      if (!res.ok) throw new Error('Could not load the insurance overview.')
      return res.json() as Promise<{ overview: Overview; availableSegments: InsuranceSegment[] }>
    },
    staleTime: 5 * 60 * 1000,
  })

  const rowsQuery = useQuery({
    queryKey: ['insurance-360', 'vehicles', brand, segment, search],
    queryFn: async () => {
      const params = new URLSearchParams({ brand, view: 'vehicles', limit: '60' })
      if (segment) params.set('segment', segment)
      if (search) params.set('q', search)
      const res = await fetch(`/api/insurance-360?${params}`)
      if (!res.ok) throw new Error('Could not load the vehicle list.')
      return res.json() as Promise<{ rows: Row[]; total: number }>
    },
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  const overview = overviewQuery.data?.overview
  const availableSegments = overviewQuery.data?.availableSegments ?? []
  // Stable identity: an inline ?? [] creates a fresh array each render and re-runs the memo below.
  const rows = useMemo(() => rowsQuery.data?.rows ?? [], [rowsQuery.data])
  /*
   * The timeline is the point of this screen, so one is always open: the record the user picked, or
   * the first in the list. Requiring a click first meant the story — which is the thing being asked
   * for — was never the thing you landed on.
   */
  const openRow = useMemo(
    () => rows.find((r) => r.chassisNo === openChassis) ?? rows[0] ?? null,
    [rows, openChassis],
  )

  const submitSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput.trim())
  }, [searchInput])

  return (
    <MainLayout>
      <div className="space-y-5 p-4 sm:p-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Insurance</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Insurance 360</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Every insured vehicle, its full policy chain, and whether cover has ever broken.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {BRANDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => { setBrand(b.id); setSegment(null); setOpenChassis(null) }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500',
                  brand === b.id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900',
                )}
                aria-pressed={brand === b.id}
              >
                {b.label}
              </button>
            ))}
          </div>
        </header>

        {/* ── Overview: compact blocks, not giant cards ──────────────────── */}
        <section aria-labelledby="ins360-overview">
          <h2 id="ins360-overview" className="sr-only">Overview</h2>
          {overviewQuery.isError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              The overview could not be loaded. Reload the page to try again.
            </p>
          )}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Insured vehicles" value={overview?.vehicles} loading={overviewQuery.isLoading} />
            <Stat label="Policies" value={overview?.policies} loading={overviewQuery.isLoading}
              hint="Own-damage policies. Third-party companions are not counted as separate policies." />
            <Stat label="Cover active" value={overview?.activeCover} loading={overviewQuery.isLoading} />
            <Stat label="Due for renewal" value={overview?.dueForRenewal} loading={overviewQuery.isLoading} tone="amber" />
            <Stat label="Lapsed" value={overview?.lapsed} loading={overviewQuery.isLoading} tone="rose" />
            <Stat label="Never lapsed" value={overview?.neverLapsed} loading={overviewQuery.isLoading} tone="emerald"
              hint="Two or more policies with no break in cover beyond 30 days." />
          </div>

          {/* Facts the numbers depend on — stated, not buried in a tooltip. */}
          {overview?.caveats?.length ? (
            <ul className="mt-2 space-y-1">
              {overview.caveats.map((c) => (
                <li key={c} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {openRow && <PolicyTimeline row={openRow} />}

        {/* ── Segments + search ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentPill active={segment === null} onClick={() => setSegment(null)} label="All" />
            {availableSegments.map((s) => (
              <SegmentPill
                key={s}
                active={segment === s}
                onClick={() => setSegment(segment === s ? null : s)}
                label={SEGMENT_LABEL[s]}
              />
            ))}
            <form onSubmit={submitSearch} className="ml-auto flex items-center gap-2" role="search">
              <label htmlFor="ins360-search" className="sr-only">Search by name, chassis or registration</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  id="ins360-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Name, chassis or registration"
                  className="h-9 w-64 pl-8 text-sm"
                />
              </div>
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearch('') }}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-3 w-3" aria-hidden /> Clear
                </button>
              )}
            </form>
          </div>

          {/* ── The table ────────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* Wide content scrolls INSIDE its own container; the page body never scrolls sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">
                  Insured vehicles with their policy chain and current cover status
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-3 py-2.5">Vehicle</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Policies</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Renewals</th>
                    <th scope="col" className="px-3 py-2.5">Journey</th>
                    <th scope="col" className="px-3 py-2.5">First</th>
                    <th scope="col" className="px-3 py-2.5">Cover to</th>
                    <th scope="col" className="px-3 py-2.5">Status</th>
                    <th scope="col" className="px-3 py-2.5"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rowsQuery.isLoading && (
                    // Reserves the row height so the table does not jump when data lands.
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i} aria-hidden>
                        <td colSpan={8} className="px-3 py-3">
                          <div className="h-5 w-full animate-pulse rounded bg-slate-100" />
                        </td>
                      </tr>
                    ))
                  )}

                  {!rowsQuery.isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center">
                        <p className="text-sm font-semibold text-slate-700">Nothing matches this view</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {search
                            ? <>No vehicle matches “{search}”. Try a chassis number, a registration, or part of a name.</>
                            : 'No vehicle falls into this segment for the selected brand.'}
                        </p>
                      </td>
                    </tr>
                  )}

                  {rows.map((r) => (
                    <tr
                      key={r.chassisNo}
                      className={cn('transition-colors hover:bg-slate-50/70',
                        openRow?.chassisNo === r.chassisNo && 'bg-slate-50')}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900">{r.customerName || 'Name not recorded'}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          <span className="font-mono">{r.registration || r.chassisNo}</span>
                          {r.model && <span>· {r.model}</span>}
                          {r.relationship.reviewReasons.length > 0 && (
                            <span
                              className="inline-flex items-center gap-1 font-semibold text-amber-700"
                              title={r.relationship.reviewReasons.join(' ')}
                            >
                              <AlertCircle className="h-3 w-3" aria-hidden /> Match needs review
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                        {r.relationship.policyCount}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {r.relationship.renewalCount || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5"><JourneyStrip journey={r.relationship.journey} /></td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">
                        {fmtYear(r.relationship.firstPolicyDate)}
                        {r.relationship.leftCensored && (
                          <span className="ml-1 text-slate-400" title="Earliest policy on file is already a renewal — the relationship began before our records.">
                            +
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">{fmtDate(r.relationship.latestExpiryDate)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold',
                          STATUS_TONE[r.relationship.status] ?? STATUS_TONE.NO_COVER_ON_RECORD)}>
                          {r.statusLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setOpenChassis(openChassis === r.chassisNo ? null : r.chassisNo)}
                          className="inline-flex items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 cursor-pointer"
                          aria-expanded={openRow?.chassisNo === r.chassisNo}
                        >
                          {openRow?.chassisNo === r.chassisNo ? 'Showing' : 'Timeline'}
                          <ChevronRight className={cn('h-3 w-3 transition-transform', openRow?.chassisNo === r.chassisNo && 'rotate-90')} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rowsQuery.data && rows.length > 0 && (
              <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                Showing {num(rows.length)} of {num(rowsQuery.data.total)} vehicles
                {segment ? ` in ${SEGMENT_LABEL[segment]}` : ''}
              </div>
            )}
          </div>
        </section>

      </div>
    </MainLayout>
  )
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value, loading, tone, hint }: {
  label: string; value: number | undefined; loading: boolean
  tone?: 'amber' | 'rose' | 'emerald'; hint?: string
}) {
  const toneCls = tone === 'amber' ? 'text-amber-700'
    : tone === 'rose' ? 'text-rose-700'
      : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-900'
  return (
    <div className="bg-white px-3 py-2.5" title={hint}>
      <div className="flex items-center gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {hint && <Info className="h-2.5 w-2.5 shrink-0 text-slate-300" aria-hidden />}
      </div>
      {/* Fixed height so the block does not resize when the number arrives. */}
      <p className={cn('mt-0.5 h-7 text-xl font-bold tabular-nums leading-7', toneCls)}>
        {loading ? <span className="inline-block h-5 w-12 animate-pulse rounded bg-slate-100 align-middle" />
          : value === undefined ? '—' : num(value)}
      </p>
    </div>
  )
}

function SegmentPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500',
        active ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
      )}
    >
      {label}
    </button>
  )
}

/**
 * The journey, inline. One tick per policy, a break where cover lapsed.
 *
 * ⚠️ Not colour alone: a lapse is drawn as a visible GAP with a rule through it, so the break reads
 * without relying on hue, and the title attribute states it in words.
 */
function JourneyStrip({ journey }: { journey: Journey[] }) {
  if (!journey.length) return <span className="text-slate-300">—</span>
  return (
    <div className="flex items-center gap-0.5" role="img"
      aria-label={`${journey.length} policies, ${journey.filter((s) => s.brokeCover).length} break(s) in cover`}>
      {journey.map((s) => (
        <span key={s.sequence} className="flex items-center gap-0.5">
          {s.brokeCover && (
            <span className="mx-0.5 h-3 w-3 shrink-0 border-t border-dashed border-rose-400"
              title={`${s.gapDays} days without cover`} aria-hidden />
          )}
          <span
            className={cn('h-4 w-1.5 rounded-sm', EVENT_TONE[s.eventType], s.active && 'ring-1 ring-emerald-500 ring-offset-1')}
            title={`${s.eventType} · ${fmtDate(s.startDate)} to ${fmtDate(s.expiryDate)}${s.insurer ? ` · ${s.insurer}` : ''}`}
          />
        </span>
      ))}
    </div>
  )
}

/**
 * THE TIMELINE. Bought, renewed, lapsed, rolled over — in order, as one story.
 *
 * ── What this replaced, and why ───────────────────────────────────────────────────────────────
 * The first version listed the policies in a table with the break in cover reduced to a badge on
 * the policy that followed it. That reads as a ledger: you can extract the story from it, but you
 * have to do the work. The question this screen exists to answer is "what happened with this
 * customer", so the events are the rows.
 *
 * ⚠️ A LAPSE IS ITS OWN EVENT. Losing cover for 90 days is a thing that happened to the customer —
 * arguably the most important thing on the record, because it is the moment we nearly lost them.
 * It gets a node on the spine, with its dates and duration, not a chip on the next policy.
 *
 * The rail is vertical rather than horizontal on purpose: a chain runs to 7 policies, and a
 * horizontal timeline at that length either scrolls sideways or crushes every node illegibly.
 */
function PolicyTimeline({ row }: { row: Row }) {
  const rel = row.relationship

  /*
   * Interleave the real gaps between policies. `gapDays` on a stop is measured from the PREVIOUS
   * stop's expiry, so the lapse node is built from the pair — and it is emitted only when cover
   * genuinely broke, never for the 1-day handover that 96% of renewals have.
   */
  const events = useMemo(() => {
    const out: Array<
      | { kind: 'policy'; stop: Journey }
      | { kind: 'lapse'; from: string | null; to: string | null; days: number }
    > = []
    rel.journey.forEach((stop, i) => {
      if (stop.brokeCover && stop.gapDays !== null) {
        out.push({ kind: 'lapse', from: rel.journey[i - 1]?.expiryDate ?? null, to: stop.startDate, days: stop.gapDays })
      }
      out.push({ kind: 'policy', stop })
    })
    return out
  }, [rel.journey])

  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="ins360-timeline">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 id="ins360-timeline" className="text-sm font-bold text-slate-900">
            {row.customerName || 'Name not recorded'}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500">
            {row.chassisNo}{row.registration ? ` · ${row.registration}` : ''}{row.model ? ` · ${row.model}` : ''}
          </p>
          {/* The one-line summary of the whole story, above the story itself. */}
          <p className="mt-1.5 text-[13px] text-slate-700">
            {rel.firstPolicyDate ? (
              <>Insured with us since <strong className="font-semibold">{fmtYear(rel.firstPolicyDate)}</strong>{rel.leftCensored ? ' or earlier' : ''}</>
            ) : 'No dated policy on file'}
            {rel.policyCount > 0 && <> · <strong className="font-semibold">{rel.policyCount}</strong> {rel.policyCount === 1 ? 'policy' : 'policies'}</>}
            {rel.renewalCount > 0 && <> · <strong className="font-semibold">{rel.renewalCount}</strong> {rel.renewalCount === 1 ? 'renewal' : 'renewals'}</>}
            {rel.rolloverCount > 0 && <> · came from another insurer</>}
            {rel.neverLapsed
              ? <span className="font-semibold text-emerald-700"> · never lapsed</span>
              : rel.longestGapDays ? <span className="font-semibold text-rose-700"> · lost cover for {rel.longestGapDays} days</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className={cn('rounded border px-2 py-1 text-[11px] font-bold',
            STATUS_TONE[rel.status] ?? STATUS_TONE.NO_COVER_ON_RECORD)}>
            {row.statusLabel}
          </span>
        </div>
      </header>

      {rel.leftCensored && (
        <p className="flex items-start gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" aria-hidden />
          <span>
            The earliest policy we hold is already a {rel.journey[0]?.eventType === 'ROLLOVER' ? 'rollover' : 'renewal'},
            so this relationship started before our records — the timeline below begins mid-story.
          </span>
        </p>
      )}

      {rel.reviewReasons.length > 0 && (
        <p className="flex items-start gap-1.5 border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-[11px] text-amber-800">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{rel.reviewReasons.join(' ')}</span>
        </p>
      )}

      {/* The spine. */}
      <ol className="relative px-4 py-3">
        {events.map((e, i) => {
          const last = i === events.length - 1
          if (e.kind === 'lapse') {
            return (
              <li key={`lapse-${i}`} className="relative flex gap-3 pb-3">
                {!last && <span className="absolute left-[7px] top-5 h-full w-px bg-rose-200" aria-hidden />}
                {/* A hollow marker: the visual language of an absence, not another policy. */}
                <span className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-rose-400 bg-white" aria-hidden />
                <div className="min-w-0 flex-1 rounded-md border border-dashed border-rose-200 bg-rose-50/50 px-2.5 py-1.5">
                  <p className="text-[12px] font-bold text-rose-700">
                    No cover for {e.days} days
                  </p>
                  <p className="text-[11px] text-rose-600/90">
                    {fmtDate(e.from)} <span className="text-rose-300">→</span> {fmtDate(e.to)}
                  </p>
                </div>
              </li>
            )
          }
          const s = e.stop
          const label = s.eventType === 'NEW' ? 'Bought first policy'
            : s.eventType === 'RENEWAL' ? 'Renewed with us'
              : s.eventType === 'ROLLOVER' ? 'Moved to us from another insurer'
                : 'Policy issued'
          return (
            <li key={`p-${s.sequence}`} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && <span className="absolute left-[7px] top-5 h-full w-px bg-slate-200" aria-hidden />}
              <span className={cn('relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white',
                EVENT_TONE[s.eventType], s.active && 'ring-2 ring-emerald-400')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-bold tabular-nums text-slate-900">{fmtYear(s.startDate)}</span>
                  <span className="text-[13px] font-semibold text-slate-800">{label}</span>
                  {s.active && (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      ACTIVE NOW
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                  <span className="tabular-nums">{fmtDate(s.startDate)} <span className="text-slate-300">→</span> {fmtDate(s.expiryDate)}</span>
                  {s.insurer && <span className="text-slate-400">·</span>}
                  {s.insurer && <span className="truncate">{s.insurer}</span>}
                  {s.grossPremium ? <span className="text-slate-400">·</span> : null}
                  {s.grossPremium ? (
                    <span className="font-semibold tabular-nums text-slate-800">
                      ₹{Math.round(s.grossPremium).toLocaleString('en-IN')}
                    </span>
                  ) : null}
                  {s.policyNo && <span className="text-slate-400">·</span>}
                  {s.policyNo && <span className="font-mono text-[10px] text-slate-400">{s.policyNo}</span>}
                </p>
              </div>
            </li>
          )
        })}

        {/* What happens next is part of the story too. */}
        {rel.status === 'DUE_FOR_RENEWAL' && rel.daysToExpiry !== null && (
          <li className="relative flex gap-3 pt-1">
            <span className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-dashed border-amber-400 bg-white" aria-hidden />
            <p className="text-[12px] font-semibold text-amber-800">
              Due for renewal in {rel.daysToExpiry} days — {fmtDate(rel.latestExpiryDate)}
            </p>
          </li>
        )}
        {(rel.status === 'LAPSED' || rel.status === 'LOST') && (
          <li className="relative flex gap-3 pt-1">
            <span className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-rose-400 bg-white" aria-hidden />
            <p className="text-[12px] font-semibold text-rose-700">
              Not renewed — cover ended {fmtDate(rel.latestExpiryDate)}
              {rel.daysToExpiry !== null && ` (${Math.abs(rel.daysToExpiry)} days ago)`}
            </p>
          </li>
        )}
      </ol>

      {rel.rowCount > rel.policyCount && (
        <p className="border-t border-slate-100 px-4 py-1.5 text-[10px] text-slate-400">
          {rel.rowCount} rows on file · {rel.policyCount} own-damage policies. Third-party companions are
          not shown as separate events.
        </p>
      )}
    </section>
  )
}
