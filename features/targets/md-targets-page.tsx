'use client'

import { useCallback, useEffect, useState } from 'react'
import { Target, Save, RotateCcw, AlertTriangle, TrendingUp, Minus, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionCard, formatCurrency } from '@/components/petty-cash/pc-shared'
import { toast } from '@/hooks/use-toast'
import {
  BRAND_TARGET_CAPABILITIES,
  TARGET_BRANDS,
  TARGET_METRICS,
  type TargetBrand,
  type TargetMetric,
} from '@/lib/targets/constants'

/**
 * The MD's current-month targets: one row per branch, two settable counts, pace against elapsed time.
 *
 * ── Why this shape ────────────────────────────────────────────────────────────────────────────
 * This replaced a 12-month x 4-metric grid that showed ONE branch at a time. Narrowing to the
 * current month freed the vertical axis, so every branch now sits on screen together — which is the
 * comparison an MD actually makes ("how is Udhampur doing against Jammu this month"), and the one
 * thing the old layout could not show at all.
 *
 * ── Why pace and not just percent ─────────────────────────────────────────────────────────────
 * A live month is always "behind". 40 of 100 units on day 10 of 31 is comfortably AHEAD, but a bare
 * 40% reads as failure. Every row therefore shows where it should be by today, and the verdict is
 * measured against that line rather than against the whole month.
 *
 * ── Why two cards, not one wide table ─────────────────────────────────────────────────────────
 * Sales counts vehicles; service counts job cards, and on two of three brands those are not even
 * the same kind of count (see serviceRoBasis). Separate cards let each own its unit and basis, so
 * the two numbers are never read as one series.
 */

type PaceVerdict = 'ahead' | 'on_track' | 'behind' | 'unknown'

type MetricCell = {
  target: number | null
  actual: number | null
  achievement: number | null
  expectedToDate: number | null
  pace: PaceVerdict
  status: 'ok' | 'no_data' | 'unavailable'
  contextValue: number | null
}

type BranchRow = {
  code: string
  label: string
  isBrandLevel: boolean
  settable: Record<TargetMetric, boolean>
  metrics: Record<TargetMetric, MetricCell>
}

type Payload = {
  brand: TargetBrand
  brandLabel: string
  period: { year: number; month: number; label: string; dayOfMonth: number; daysInMonth: number; elapsed: number }
  rows: BranchRow[]
  totals: Record<TargetMetric, MetricCell>
  unavailable: string[]
  capability: { salesGrain: 'branch' | 'brand'; serviceRoBasis: string; salesGrainNote?: string }
  canSaveTargets: boolean
}

const METRIC_LABELS: Record<TargetMetric, string> = {
  salesUnits: 'Sales',
  serviceRoCount: 'Service',
}

const METRIC_UNITS: Record<TargetMetric, string> = {
  salesUnits: 'vehicles delivered',
  serviceRoCount: 'jobs billed',
}

/** Digits only — the house input mask. */
const maskNumeric = (value: string) => value.replace(/\D/g, '').slice(0, 7)

const cellKey = (code: string, metric: TargetMetric) => `${code}|${metric}`

/**
 * Pace styling. Colour is never the ONLY signal — each verdict carries an icon and a word, so the
 * meaning survives colour blindness and the dark-mode rescue net alike.
 */
const PACE_STYLE: Record<PaceVerdict, { label: string; className: string; Icon: typeof TrendingUp }> = {
  ahead: { label: 'Ahead', className: 'text-emerald-700', Icon: TrendingUp },
  on_track: { label: 'On track', className: 'text-slate-600', Icon: Minus },
  behind: { label: 'Behind', className: 'text-rose-700', Icon: TrendingDown },
  unknown: { label: 'No target', className: 'text-slate-400', Icon: Minus },
}

export function MdTargetsWorkspace() {
  const [brand, setBrand] = useState<TargetBrand>(TARGET_BRANDS[0])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (target: TargetBrand) => {
    setLoading(true)
    setLoadError(null)
    try {
      // no-store: the query provider caches same-origin GETs for 30 minutes, which would show a
      // stale grid straight after a save.
      const res = await fetch(`/api/targets?brand=${encodeURIComponent(target)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load targets')
      setPayload(await res.json())
    } catch (error) {
      // Deliberately NOT an empty grid on error — a blank grid reads as "every target is zero".
      setPayload(null)
      setLoadError(error instanceof Error ? error.message : 'Failed to load targets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(brand), 0)
    return () => clearTimeout(id)
  }, [brand, load])

  const changeCount = Object.keys(edits).length

  const originalOf = useCallback(
    (row: BranchRow, metric: TargetMetric) =>
      (row.metrics[metric].target === null ? '' : String(row.metrics[metric].target)),
    [],
  )

  const setCell = useCallback((row: BranchRow, metric: TargetMetric, raw: string) => {
    const next = maskNumeric(raw)
    const key = cellKey(row.code, metric)
    const original = originalOf(row, metric)
    setEdits((prev) => {
      const copy = { ...prev }
      // An edit back to its original value is no longer a change — drop it so the counter stays true.
      if (next === original) delete copy[key]
      else copy[key] = next
      return copy
    })
  }, [originalOf])

  const valueOf = useCallback(
    (row: BranchRow, metric: TargetMetric) => {
      const key = cellKey(row.code, metric)
      return key in edits ? edits[key] : originalOf(row, metric)
    },
    [edits, originalOf],
  )

  const save = useCallback(async () => {
    if (!payload || changeCount === 0) return
    setSaving(true)
    try {
      // Group edits by branch so each row is written as one complete cell.
      const byCode = new Map<string, Partial<Record<TargetMetric, number | null>>>()
      for (const key of Object.keys(edits)) {
        const [code, metric] = key.split('|') as [string, TargetMetric]
        const bucket = byCode.get(code) ?? {}
        bucket[metric] = edits[key] === '' ? null : Number(edits[key])
        byCode.set(code, bucket)
      }

      const entries = Array.from(byCode.entries()).map(([code, changed]) => {
        const row = payload.rows.find((r) => r.code === code)
        const resolve = (metric: TargetMetric): number | null => {
          if (metric in changed) return changed[metric] ?? null
          if (!row?.settable[metric]) return null
          return row?.metrics[metric].target ?? null
        }
        return {
          dealerCode: code,
          year: payload.period.year,
          month: payload.period.month,
          salesUnits: resolve('salesUnits'),
          serviceRoCount: resolve('serviceRoCount'),
          // Revenue is context only and is never set from this screen.
          salesRevenue: null,
          serviceRevenue: null,
        }
      })

      const res = await fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: payload.brand, entries }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save targets')

      toast({
        title: 'Targets saved',
        description: `${entries.length} branch${entries.length === 1 ? '' : 'es'} updated for ${payload.period.label}.`,
        variant: 'success',
      })
      setEdits({})
      await load(brand)
    } catch (error) {
      toast({
        title: 'Could not save targets',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }, [payload, changeCount, edits, load, brand])

  useEffect(() => {
    if (changeCount === 0) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [changeCount])

  const daysLeft = payload ? payload.period.daysInMonth - payload.period.dayOfMonth : 0
  const elapsedPct = payload ? Math.round(payload.period.elapsed * 100) : 0

  return (
    <div className="space-y-6 pb-24">
      {/* The month is a FACT here, not a control. Stating the elapsed share up front is what makes
          every "Behind" below legible rather than alarming. */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Current month</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{payload?.period.label || '—'}</h2>
            {payload && (
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Day {payload.period.dayOfMonth} of {payload.period.daysInMonth}
                <span className="px-1.5 text-slate-300">·</span>
                {daysLeft === 0 ? 'last day' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
                <span className="px-1.5 text-slate-300">·</span>
                {elapsedPct}% elapsed
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Brand">
            {TARGET_BRANDS.map((option) => {
              const active = option === brand
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setEdits({}); setBrand(option) }}
                  className={[
                    'h-11 rounded-2xl px-4 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)] focus-visible:ring-offset-1',
                    active
                      ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)]'
                      : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  ].join(' ')}
                >
                  {BRAND_TARGET_CAPABILITIES[option].label}
                </button>
              )
            })}
          </div>
        </div>

        {/* The line every branch is judged against, drawn once. */}
        {payload && (
          <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-400" style={{ width: `${elapsedPct}%` }} />
          </div>
        )}
      </div>

      {payload && !payload.canSaveTargets && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="text-sm font-black text-amber-900">Targets cannot be saved yet</p>
            <p className="mt-0.5 text-sm font-semibold text-amber-900">
              Migration <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">0043_add_md_branch_targets.sql</code> has not been applied. Actuals below are live.
            </p>
          </div>
        </div>
      )}

      {payload && payload.unavailable.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-sm font-semibold text-amber-900">
            Could not read {payload.unavailable.join(' and ')}. Those figures show “—”, never zero.
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={`sk-${i}`} className="h-80 animate-pulse motion-reduce:animate-none rounded-3xl bg-slate-50" />
          ))}
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-bold text-rose-900">{loadError}</p>
          <Button variant="outline" className="mt-3 h-10 rounded-xl font-bold" onClick={() => void load(brand)}>
            Retry
          </Button>
        </div>
      ) : payload ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {TARGET_METRICS.map((metric) => (
            <SectionCard
              key={metric}
              title={METRIC_LABELS[metric]}
              subtitle={metric === 'serviceRoCount'
                ? `${METRIC_UNITS[metric]} · ${payload.capability.serviceRoBasis}`
                : METRIC_UNITS[metric]}
              icon={Target}
              iconTone={metric === 'salesUnits' ? 'blue' : 'violet'}
            >
              <div className="overflow-x-auto p-5">
                {/* Hand-rolled table: md-targets-grid opts out of the global !important thead paint. */}
                <table className="md-targets-grid w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-slate-200 px-2 py-2 text-left text-[11px] font-black uppercase tracking-wider text-slate-500">Branch</th>
                      <th scope="col" className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Target</th>
                      <th scope="col" className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Actual</th>
                      <th scope="col" className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-wider text-slate-500">Pace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/*
                      * ⚠️ For a brand whose feed cannot split sales by outlet, the SALES card shows
                      * only the brand row. Rendering the branch rows too would repeat the identical
                      * brand figure down the column — Hyundai showed "31" on all six branches, which
                      * reads as 186 sold. Service still lists every branch, because service data
                      * genuinely is per branch.
                      */}
                    {payload.rows
                      .filter((row) => !(metric === 'salesUnits' && payload.capability.salesGrain === 'brand' && !row.isBrandLevel))
                      .map((row) => {
                      const cell = row.metrics[metric]
                      const settable = row.settable[metric] && payload.canSaveTargets
                      const dirty = cellKey(row.code, metric) in edits
                      const pace = PACE_STYLE[cell.pace]
                      return (
                        <tr key={row.code} className={row.isBrandLevel ? 'bg-slate-50' : undefined}>
                          <th scope="row" className="border-b border-slate-100 px-2 py-2.5 text-left font-bold">
                            <span className={row.isBrandLevel ? 'font-black text-slate-900' : 'text-slate-700'}>
                              {row.label}
                            </span>
                            {cell.contextValue !== null && cell.contextValue > 0 && (
                              <span className="ml-2 text-xs font-semibold tabular-nums text-slate-400">
                                {formatCurrency(cell.contextValue)}
                              </span>
                            )}
                          </th>
                          <td className="border-b border-slate-100 px-2 py-2.5 text-right">
                            {settable ? (
                              <Input
                                value={valueOf(row, metric)}
                                onChange={(e) => setCell(row, metric, e.target.value)}
                                inputMode="numeric"
                                placeholder="—"
                                aria-label={`${METRIC_LABELS[metric]} target for ${row.label}`}
                                className={[
                                  'ml-auto h-10 w-24 rounded-xl text-right tabular-nums',
                                  dirty ? 'border-l-4 border-l-indigo-500 bg-indigo-50' : '',
                                ].join(' ')}
                              />
                            ) : (
                              <span className="text-sm font-semibold tabular-nums text-slate-400">
                                {cell.target === null ? '—' : cell.target.toLocaleString('en-IN')}
                              </span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2.5 text-right">
                            <span className="text-base font-black tabular-nums text-slate-900">
                              {cell.status === 'unavailable' ? '—' : (cell.actual ?? 0).toLocaleString('en-IN')}
                            </span>
                            {cell.expectedToDate !== null && (
                              <span className="block text-[11px] font-semibold tabular-nums text-slate-400">
                                {cell.expectedToDate.toLocaleString('en-IN')} due by today
                              </span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2.5 text-right">
                            {cell.status === 'unavailable' ? (
                              <span className="text-xs font-bold text-amber-700">Unavailable</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-xs font-black ${pace.className}`}>
                                <pace.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                {pace.label}
                                {cell.achievement !== null && (
                                  <span className="font-bold tabular-nums">{cell.achievement}%</span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                      })}
                  </tbody>
                </table>

                {metric === 'salesUnits' && payload.capability.salesGrainNote && (
                  <p className="mt-3 text-xs font-semibold text-slate-500">{payload.capability.salesGrainNote}</p>
                )}
              </div>
            </SectionCard>
          ))}
        </div>
      ) : null}

      {changeCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white p-4 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-black text-slate-800">
              {changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setEdits({})} disabled={saving} className="h-11 gap-2 rounded-2xl font-bold">
                <RotateCcw className="h-4 w-4" /> Discard
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving}
                className="h-11 gap-2 rounded-2xl bg-[var(--dashboard-action-bg)] font-bold text-[var(--dashboard-action-fg)] hover:bg-[var(--dashboard-action-hover)]"
              >
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save targets'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
