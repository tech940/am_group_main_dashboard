'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { FuelSettingsResponse } from '@/lib/fuel-management/types'
import { fetchFuel, sendFuel } from './fuel-data'
import { Chip, EmptyState, Loading, Panel, Skeleton, fmtEff, fmtQty, fmtWhen } from './fuel-ui'

type Benchmark = FuelSettingsResponse['benchmarks'][number]

type Draft = {
  id: string | null
  scope: Benchmark['scope']
  vin: string
  model: string
  variant: string
  energyType: string
  unit: string
  expectedEfficiency: string
  tankCapacity: string
  notes: string
}

const EMPTY_DRAFT: Draft = {
  id: null,
  scope: 'model',
  vin: '',
  model: '',
  variant: '',
  energyType: 'petrol',
  unit: 'L',
  expectedEfficiency: '',
  tankCapacity: '',
  notes: '',
}

const SCOPE_WORD: Record<Benchmark['scope'], string> = { vehicle: 'One car', model_variant: 'Variant', model: 'Model' }
const ENERGY_WORD: Record<string, string> = { petrol: 'Petrol', diesel: 'Diesel', cng: 'CNG', ev: 'Electric', hybrid: 'Hybrid' }
const UNIT_FOR: Record<string, string> = { petrol: 'L', diesel: 'L', cng: 'kg', ev: 'kWh', hybrid: 'L' }

const inputClass = 'h-9 w-full rounded-xl border border-slate-200/90 bg-white px-3 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/10 shadow-2xs transition-all disabled:bg-slate-50 disabled:text-slate-500'

/**
 * What the numbers are measured against. Changing a target re-labels a fleet, so only people with the
 * fuel_management.edit permission can save; everyone else sees the same values read-only, with who set them.
 */
export function SettingsView() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['fuel-management', 'settings'],
    queryFn: () => fetchFuel<FuelSettingsResponse>('/api/fuel-management/settings'),
    staleTime: 60_000,
  })
  const data = query.data
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [thresholds, setThresholds] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState<string>('')
  // One message per place it belongs, so an error never shows up under the wrong panel.
  const [errors, setErrors] = React.useState<{ form?: string; thresholds?: string; list?: string }>({})
  const formHeading = React.useRef<HTMLHeadingElement | null>(null)
  const addButton = React.useRef<HTMLButtonElement | null>(null)
  const returnTo = React.useRef<HTMLElement | null>(null)

  const openDraft = (next: Draft) => {
    returnTo.current = document.activeElement as HTMLElement | null
    setErrors((e) => ({ ...e, form: undefined }))
    setDraft(next)
    window.setTimeout(() => {
      formHeading.current?.scrollIntoView({ block: 'nearest' })
      document.getElementById('bm-scope')?.focus()
    }, 0)
  }
  const closeDraft = () => {
    setDraft(null)
    setErrors((e) => ({ ...e, form: undefined }))
    window.setTimeout(() => (returnTo.current && document.contains(returnTo.current) ? returnTo.current : addButton.current)?.focus(), 0)
  }

  // Load the saved values — but never over edits the person has not saved yet.
  const dirty = React.useRef(false)
  React.useEffect(() => {
    if (!data || dirty.current) return
    setThresholds(Object.fromEntries(data.settings.map((s) => [s.key, String(s.value)])))
  }, [data])

  const apply = async (payload: unknown, label: string, success: string, where: 'form' | 'thresholds' | 'list') => {
    setSaving(label)
    setErrors((e) => ({ ...e, [where]: undefined }))
    try {
      const next = await sendFuel<FuelSettingsResponse>('/api/fuel-management/settings', 'PUT', payload)
      if (where === 'thresholds') dirty.current = false
      queryClient.setQueryData(['fuel-management', 'settings'], next)
      await queryClient.invalidateQueries({ queryKey: ['fuel-management', 'overview'] })
      toast({ title: success, variant: 'success' })
      return true
    } catch (err) {
      setErrors((e) => ({ ...e, [where]: err instanceof Error ? err.message : 'The change could not be saved.' }))
      return false
    } finally {
      setSaving('')
    }
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Fuel settings could not be loaded"
        action={<button type="button" onClick={() => query.refetch()} className="inline-flex h-8.5 items-center rounded-xl border border-slate-200 bg-white px-3.5 text-[12.5px] font-semibold text-slate-700 shadow-2xs hover:text-slate-900">Try again</button>}
      >
        {query.error instanceof Error ? query.error.message : null}
      </EmptyState>
    )
  }
  if (!data) return <Loading label="Loading fuel settings"><Skeleton className="h-80 w-full" /></Loading>

  const canEdit = data.canEdit
  const selectedModel = data.models.find((m) => m.model.toUpperCase() === (draft?.model ?? '').toUpperCase())
  const changedThresholds = data.settings.filter((s) => thresholds[s.key] !== undefined && Number(thresholds[s.key]) !== s.value)

  const saveDraft = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const ok = await apply(
      {
        benchmark: {
          id: draft.id,
          scope: draft.scope,
          vin: draft.vin,
          model: draft.model,
          variant: draft.variant,
          energyType: draft.energyType,
          unit: draft.unit,
          expectedEfficiency: draft.expectedEfficiency || null,
          tankCapacity: draft.tankCapacity || null,
          notes: draft.notes,
        },
      },
      'benchmark',
      draft.id ? 'Benchmark updated' : 'Benchmark added',
      'form',
    )
    if (ok) closeDraft()
    return ok
  }

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Panel
        id="fm-benchmarks"
        title="Expected mileage and tank size"
        className="xl:col-span-2"
        bodyClassName="p-0"
        action={canEdit && !draft && (
          <button
            ref={addButton}
            type="button"
            onClick={() => openDraft({ ...EMPTY_DRAFT })}
            className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 text-[12.5px] font-semibold text-white shadow-2xs transition-all hover:bg-teal-800"
          >
            <Plus aria-hidden className="size-3.5" /> Add benchmark
          </button>
        )}
      >
        <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
          A car is judged against the most specific benchmark that fits: its own VIN, then its model and variant, then its model.
          With no benchmark a car shows &ldquo;No target set&rdquo; — nothing is assumed.
          {!canEdit && ' You can view these; changing them needs the Fuel Management edit permission.'}
        </div>

        {draft && (
          <form onSubmit={saveDraft} aria-labelledby="bm-form-title" className="space-y-3.5 border-b border-slate-100 bg-slate-50/80 p-5">
            <h3 id="bm-form-title" ref={formHeading} tabIndex={-1} className="text-[13.5px] font-bold text-slate-900">
              {draft.id ? `Edit benchmark for ${draft.vin || [draft.model, draft.variant].filter(Boolean).join(' · ')}` : 'Add a benchmark'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="bm-scope" className="mb-1.5 block text-[12px] font-bold text-slate-700">Applies to</label>
                <select
                  id="bm-scope"
                  value={draft.scope}
                  onChange={(e) => setDraft({ ...draft, scope: e.target.value as Benchmark['scope'] })}
                  className={inputClass}
                >
                  <option value="model">A model</option>
                  <option value="model_variant">A model and variant</option>
                  <option value="vehicle">One car (by VIN)</option>
                </select>
              </div>
              {draft.scope === 'vehicle' ? (
                <div className="sm:col-span-2">
                  <label htmlFor="bm-vin" className="mb-1.5 block text-[12px] font-bold text-slate-700">VIN</label>
                  <input id="bm-vin" name="benchmark-vin" autoComplete="off" spellCheck={false} value={draft.vin} maxLength={17} onChange={(e) => setDraft({ ...draft, vin: e.target.value.toUpperCase() })} placeholder="e.g. MZBEA812LTN087341…" className={cn(inputClass, 'font-mono')} />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="bm-model" className="mb-1.5 block text-[12px] font-bold text-slate-700">Model</label>
                    <input id="bm-model" name="benchmark-model" autoComplete="off" spellCheck={false} list="bm-models" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="e.g. SELTOS…" className={inputClass} />
                    <datalist id="bm-models">
                      {data.models.map((m) => <option key={m.model} value={m.model}>{`${m.cars} demo car${m.cars === 1 ? '' : 's'}`}</option>)}
                    </datalist>
                  </div>
                  {draft.scope === 'model_variant' && (
                    <div>
                      <label htmlFor="bm-variant" className="mb-1.5 block text-[12px] font-bold text-slate-700">Variant</label>
                      <input id="bm-variant" name="benchmark-variant" autoComplete="off" spellCheck={false} list="bm-variants" value={draft.variant} onChange={(e) => setDraft({ ...draft, variant: e.target.value })} placeholder="e.g. HTX…" className={inputClass} />
                      <datalist id="bm-variants">
                        {(selectedModel?.variants ?? []).map((variant) => <option key={variant} value={variant} />)}
                      </datalist>
                    </div>
                  )}
                </>
              )}
              <div>
                <label htmlFor="bm-energy" className="mb-1.5 block text-[12px] font-bold text-slate-700">Fuel</label>
                <select
                  id="bm-energy"
                  value={draft.energyType}
                  onChange={(e) => setDraft({ ...draft, energyType: e.target.value, unit: UNIT_FOR[e.target.value] ?? 'L' })}
                  className={inputClass}
                >
                  <option value="petrol">Petrol</option>
                  <option value="diesel">Diesel</option>
                  <option value="cng">CNG</option>
                  <option value="ev">Electric</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <label htmlFor="bm-eff" className="mb-1.5 block text-[12px] font-bold text-slate-700">Expected mileage (km/{draft.unit})</label>
                <input id="bm-eff" type="number" inputMode="decimal" min="0" step="0.1" value={draft.expectedEfficiency} onChange={(e) => setDraft({ ...draft, expectedEfficiency: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="bm-tank" className="mb-1.5 block text-[12px] font-bold text-slate-700">Tank capacity ({draft.unit})</label>
                <input id="bm-tank" type="number" inputMode="decimal" min="0" step="0.1" value={draft.tankCapacity} onChange={(e) => setDraft({ ...draft, tankCapacity: e.target.value })} className={inputClass} />
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="bm-notes" className="mb-1.5 block text-[12px] font-bold text-slate-700">Source or note <span className="font-normal text-slate-500">optional</span></label>
                <input id="bm-notes" value={draft.notes} maxLength={300} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. Kia brochure figure, city driving…" className={inputClass} />
              </div>
            </div>
            {errors.form && <p role="alert" className="text-[12.5px] font-medium text-rose-600">{errors.form}</p>}
            <div className="flex items-center gap-2.5 pt-1">
              <button type="submit" disabled={saving === 'benchmark'} className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 text-[12.5px] font-semibold text-white shadow-2xs hover:bg-teal-800 disabled:opacity-60">
                {saving === 'benchmark' && <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
                {draft.id ? 'Save benchmark' : 'Add benchmark'}
              </button>
              <button type="button" onClick={closeDraft} className="h-8.5 px-3 text-[12.5px] font-semibold text-slate-500 hover:text-slate-900">Cancel</button>
            </div>
          </form>
        )}

        {errors.list && <p role="alert" className="px-5 pt-3 text-[12.5px] font-medium text-rose-600">{errors.list}</p>}
        {data.benchmarks.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No benchmarks yet">
              Without one, mileage is still measured, but no car can be called above or below target, and fills are not checked against a tank size.
            </EmptyState>
          </div>
        ) : (
          <div className="fm-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="border-b border-teal-100/60 bg-gradient-to-r from-slate-50 via-teal-50/40 to-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th scope="col" className="px-5 py-3.5 font-bold">Applies to</th>
                  <th scope="col" className="px-4 py-3.5 font-bold">Fuel</th>
                  <th scope="col" className="px-4 py-3.5 text-right font-bold">Expected Mileage</th>
                  <th scope="col" className="px-4 py-3.5 text-right font-bold">Tank Capacity</th>
                  <th scope="col" className="px-4 py-3.5 font-bold">Set by</th>
                  {canEdit && <th scope="col" className="px-4 py-3.5"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.benchmarks.map((b) => {
                  const scopeTheme = b.scope === 'vehicle'
                    ? 'bg-indigo-50 text-indigo-700 ring-indigo-200/70'
                    : b.scope === 'model_variant'
                    ? 'bg-sky-50 text-sky-700 ring-sky-200/70'
                    : 'bg-teal-50 text-teal-700 ring-teal-200/70'

                  const energyTheme = b.energyType === 'petrol'
                    ? 'bg-amber-50 text-amber-800 ring-amber-200/70'
                    : b.energyType === 'diesel'
                    ? 'bg-blue-50 text-blue-800 ring-blue-200/70'
                    : b.energyType === 'cng'
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200/70'
                    : 'bg-cyan-50 text-cyan-800 ring-cyan-200/70'

                  return (
                    <tr key={b.id} className="transition-colors hover:bg-teal-50/20">
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{b.vin ?? [b.model, b.variant].filter(Boolean).join(' · ')}</span>
                          <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1', scopeTheme)}>
                            {SCOPE_WORD[b.scope]}
                          </span>
                        </div>
                        {b.notes && <span className="mt-1 block text-[11.5px] text-slate-500">{b.notes}</span>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold ring-1', energyTheme)}>
                          {ENERGY_WORD[b.energyType] ?? b.energyType}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-mono font-bold tabular-nums text-emerald-900">{fmtEff(b.expectedEfficiency, b.unit)}</td>
                      <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums text-slate-800">{fmtQty(b.tankCapacity, b.unit)}</td>
                      <td className="px-4 py-4 text-[12px] text-slate-500">
                        <span className="font-medium text-slate-700">{b.setByName ?? '—'}</span>
                        <span className="block text-slate-400">{fmtWhen(b.updatedAt)}</span>
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-4 py-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Edit benchmark for ${b.vin ?? [b.model, b.variant].filter(Boolean).join(' · ')}`}
                              title="Edit"
                              onClick={() => openDraft({
                                id: b.id, scope: b.scope, vin: b.vin ?? '', model: b.model ?? '', variant: b.variant ?? '',
                                energyType: b.energyType, unit: b.unit,
                                expectedEfficiency: b.expectedEfficiency === null ? '' : String(b.expectedEfficiency),
                                tankCapacity: b.tankCapacity === null ? '' : String(b.tankCapacity),
                                notes: b.notes ?? '',
                              })}
                              className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                            >
                              <Pencil aria-hidden className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete benchmark for ${b.vin ?? [b.model, b.variant].filter(Boolean).join(' · ')}`}
                              title="Delete"
                              disabled={saving === `delete:${b.id}`}
                              onClick={() => {
                                if (window.confirm('Delete this benchmark? Cars it applied to will show "No target set" until another applies.')) {
                                  void apply({ deleteBenchmarkId: b.id }, `delete:${b.id}`, 'Benchmark deleted', 'list')
                                }
                              }}
                              className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 aria-hidden className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="fm-thresholds" title="When something counts as unusual" bodyClassName="p-0">
        <ul className="divide-y divide-slate-100">
          {data.settings.map((s) => (
            <li key={s.key} className="flex items-center gap-3 px-5 py-3.5">
              <label htmlFor={`th-${s.key}`} className="min-w-0 flex-1 text-[12.5px] leading-snug font-medium text-slate-700">
                {s.label}
                {s.overridden && <span className="ml-1.5 text-[11px] font-normal text-slate-500">(standard {s.defaultValue})</span>}
              </label>
              <span className="flex shrink-0 items-center gap-2">
                <input
                  id={`th-${s.key}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  readOnly={!canEdit}
                  aria-describedby={`th-${s.key}-unit`}
                  value={thresholds[s.key] ?? ''}
                  onChange={(e) => {
                    dirty.current = true
                    setThresholds((t) => ({ ...t, [s.key]: e.target.value }))
                  }}
                  className={cn(inputClass, 'w-22 text-right font-mono font-semibold tabular-nums')}
                />
                <span id={`th-${s.key}-unit`} className="w-14 text-[11.5px] font-medium text-slate-500">{s.unit}</span>
              </span>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5">
            <button
              type="button"
              disabled={changedThresholds.length === 0 || saving === 'thresholds'}
              onClick={() => void apply(
                { settings: Object.fromEntries(changedThresholds.map((s) => [s.key, thresholds[s.key] === '' ? null : Number(thresholds[s.key])])) },
                'thresholds',
                'Thresholds saved',
                'thresholds',
              )}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 text-[12.5px] font-semibold text-white shadow-2xs transition-all hover:bg-teal-800 disabled:opacity-40"
            >
              {saving === 'thresholds' && <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
              Save {changedThresholds.length || ''} change{changedThresholds.length === 1 ? '' : 's'}
            </button>
            {data.settings.some((s) => s.overridden) && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Restore every threshold to its standard value? Your team\u2019s custom values will be replaced.')) return
                  void apply(
                    { settings: Object.fromEntries(data.settings.filter((s) => s.overridden).map((s) => [s.key, null])) },
                    'thresholds',
                    'Standard thresholds restored',
                    'thresholds',
                  )
                }}
                className="h-8.5 px-3 text-[12.5px] font-semibold text-slate-500 hover:text-slate-900"
              >
                Restore standard values
              </button>
            )}
            {errors.thresholds && <p role="alert" className="w-full text-[12.5px] font-medium text-rose-600">{errors.thresholds}</p>}
          </div>
        )}
        {data.changes.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Recent changes</h3>
            <ul className="space-y-2">
              {data.changes.slice(0, 8).map((c, i) => (
                <li key={`${c.at}-${i}`} className="text-[12px] leading-snug text-slate-600">
                  <span className="font-medium text-slate-500">{fmtWhen(c.at)}</span> · <span className="font-semibold text-slate-800">{c.actorName}</span> {c.action}d {c.target === 'setting' ? 'a threshold' : 'a benchmark'}
                  {c.label ? <span className="text-slate-500"> — {c.label}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  )
}
