'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Percent, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OPTION_KIND_LABELS, OPTION_KINDS, type OptionKind } from '@/lib/h-promise/constants'
import { ECONOMICS_FORMULA_VERSION } from '@/lib/h-promise/economics'
import type { HpOption } from '@/lib/h-promise/types'
import { toast } from '@/hooks/use-toast'
import { hpSend, useHpMutation, useSettingsHistory } from './hp-data'
import { useHpSection } from './hp-context'
import { day, when } from './hp-format'
import { DateInput, FormField, TextInput } from './hp-form'
import { EmptyState, ErrorState, HpButton, LoadingBlock, Panel, ToneChip } from './hp-ui'

export function SettingsView() {
  const { caps, meta } = useHpSection()
  if (!meta) return <LoadingBlock label="Loading settings" rows={5} />
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {OPTION_KINDS.map((kind) => (
        <OptionList key={kind} kind={kind} options={meta.options[kind]} editable={caps.settings.edit} />
      ))}
      <RatesPanel editable={caps.settings.edit} />
      <HistoryPanel />
    </div>
  )
}

function OptionList({ kind, options, editable }: { kind: OptionKind; options: HpOption[]; editable: boolean }) {
  const text = OPTION_KIND_LABELS[kind]
  const [adding, setAdding] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const create = useHpMutation((label: string) => hpSend('/api/h-promise/options', 'POST', { kind, label }), { meta: true })
  const update = useHpMutation((input: { id: string; body: Record<string, unknown> }) => hpSend(`/api/h-promise/options/${input.id}`, 'PATCH', input.body), { meta: true })
  const sorted = [...options].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  const active = sorted.filter((o) => o.isActive)
  const inputId = `hp-add-${kind}`

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null)
    try {
      await fn()
      if (done) toast({ title: done, variant: 'success' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That could not be saved.')
    }
  }

  const move = (option: HpOption, direction: -1 | 1) => {
    const index = active.findIndex((o) => o.id === option.id)
    const other = active[index + direction]
    if (!other) return
    void run(async () => {
      await update.mutateAsync({ id: option.id, body: { sortOrder: other.sortOrder } })
      await update.mutateAsync({ id: other.id, body: { sortOrder: option.sortOrder === other.sortOrder ? option.sortOrder + direction : option.sortOrder } })
    })
  }

  return (
    <Panel title={text.plural} description={text.hint} bodyClassName="p-0">
      <ul className="divide-y divide-slate-100">
        {sorted.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No {text.plural.toLowerCase()} yet.</li>}
        {sorted.map((option) => (
          <li key={option.id} className={cn('flex items-center gap-2 px-4 py-2', !option.isActive && 'opacity-60')}>
            {editingId === option.id ? (
              <form
                className="flex flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(async () => {
                    await update.mutateAsync({ id: option.id, body: { label: draft } })
                    setEditingId(null)
                  }, 'Name updated')
                }}
              >
                <label htmlFor={`rename-${option.id}`} className="sr-only">New name for {option.label}</label>
                <TextInput id={`rename-${option.id}`} value={draft} onValue={setDraft} className="h-8" autoFocus />
                <button type="submit" className="rounded-md p-1.5 hp-hover text-slate-500" aria-label="Save name"><Check className="h-4 w-4" aria-hidden="true" /></button>
                <button type="button" onClick={() => setEditingId(null)} className="rounded-md p-1.5 hp-hover text-slate-500" aria-label="Cancel"><X className="h-4 w-4" aria-hidden="true" /></button>
              </form>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{option.label}</p>
                  {option.label.toUpperCase() !== option.value && <p className="hp-mono truncate text-[10.5px] text-slate-400">{option.value}</p>}
                </div>
                {!option.isActive && <ToneChip tone="neutral">Hidden</ToneChip>}
                {editable && (
                  <div className="flex shrink-0 items-center">
                    {option.isActive && (
                      <>
                        <IconButton label={`Move ${option.label} up`} onClick={() => move(option, -1)} disabled={active[0]?.id === option.id}><ArrowUp /></IconButton>
                        <IconButton label={`Move ${option.label} down`} onClick={() => move(option, 1)} disabled={active[active.length - 1]?.id === option.id}><ArrowDown /></IconButton>
                      </>
                    )}
                    <IconButton label={`Rename ${option.label}`} onClick={() => { setEditingId(option.id); setDraft(option.label) }}><Pencil /></IconButton>
                    <IconButton
                      label={option.isActive ? `Hide ${option.label} from the forms` : `Offer ${option.label} again`}
                      onClick={() => void run(() => update.mutateAsync({ id: option.id, body: { isActive: !option.isActive } }), option.isActive ? `${option.label} hidden` : `${option.label} offered again`)}
                    >
                      {option.isActive ? <EyeOff /> : <Eye />}
                    </IconButton>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="flex items-end gap-2 border-t border-slate-100 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!adding.trim()) return
            void run(async () => {
              await create.mutateAsync(adding)
              setAdding('')
            }, `${adding.trim()} added`)
          }}
        >
          <div className="flex-1">
            <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-slate-700">Add a {text.singular.toLowerCase()}</label>
            <TextInput id={inputId} value={adding} onValue={setAdding} maxLength={80} className="h-9" />
          </div>
          <HpButton type="submit" variant="soft" busy={create.isPending} disabled={!adding.trim()}><Plus /> Add</HpButton>
        </form>
      )}
      {error && <p role="alert" data-tone="rejected" className="hp-tone-text px-4 pb-3 text-xs font-medium">{error}</p>}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Hiding keeps the name on the vehicles that already use it.</p>
    </Panel>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactElement }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="rounded-md p-1.5 hp-hover text-slate-400 disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5">
      {children}
    </button>
  )
}

function RatesPanel({ editable }: { editable: boolean }) {
  const { meta } = useHpSection()
  const [from, setFrom] = React.useState('')
  const [rate, setRate] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const add = useHpMutation((body: Record<string, unknown>) => hpSend('/api/h-promise/rates', 'POST', body), { meta: true })
  const remove = useHpMutation((id: string) => hpSend(`/api/h-promise/rates/${id}`, 'DELETE'), { meta: true })
  const rows = meta?.rateRows ?? []
  const today = meta?.today ?? ''
  const current = [...rows].filter((row) => row.effectiveFrom <= today).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      await add.mutateAsync({ effectiveFrom: from, ratePct: rate, note })
      toast({ title: 'Interest rate added', variant: 'success' })
      setFrom('')
      setRate('')
      setNote('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The rate could not be saved.')
    }
  }

  return (
    <Panel
      title="Interest on stock"
      description="Charged on the purchase price (without GST) from purchase to sale. Net profit is gross profit with GST, less this."
      action={current ? <ToneChip tone="accent"><Percent className="h-3 w-3" aria-hidden="true" /> {current.ratePct} % a year now</ToneChip> : undefined}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="hp-num w-16 text-lg font-semibold text-slate-900">{row.ratePct} %</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-slate-700">{row.effectiveFrom <= '2000-01-01' ? 'From the start' : `From ${day(row.effectiveFrom)}`}</p>
              <p className="truncate text-[11.5px] text-slate-500">{row.note ?? `Added by ${row.createdByName}`}</p>
            </div>
            {editable && row.effectiveFrom > today && (
              <IconButton label="Remove this future rate" onClick={() => remove.mutateAsync(row.id).catch((e) => setError(e.message))}><Trash2 /></IconButton>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form onSubmit={submit} className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3">
          <FormField label="New rate from" htmlFor="rate-from">
            <DateInput id="rate-from" value={from} onValue={setFrom} />
          </FormField>
          <FormField label="Yearly rate (%)" htmlFor="rate-pct">
            <TextInput id="rate-pct" inputMode="decimal" value={rate} onValue={(v) => setRate(v.replace(/[^\d.]/g, ''))} className="hp-num" />
          </FormField>
          <div className="col-span-2">
            <FormField label="Note" htmlFor="rate-note">
              <TextInput id="rate-note" value={note} onValue={setNote} maxLength={300} placeholder="e.g. Bank revised the working-capital rate" />
            </FormField>
          </div>
          <div className="col-span-2 flex justify-end">
            <HpButton type="submit" variant="soft" busy={add.isPending} disabled={!from || !rate}><Plus /> Add rate</HpButton>
          </div>
        </form>
      )}
      {error && <p role="alert" data-tone="rejected" className="hp-tone-text px-4 pb-3 text-xs font-medium">{error}</p>}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Each rate applies only to the days it was in force. Formulas: {ECONOMICS_FORMULA_VERSION}.</p>
    </Panel>
  )
}

function HistoryPanel() {
  const query = useSettingsHistory(true)
  const rows = query.data?.rows ?? []
  const describe = (row: (typeof rows)[number]) => {
    const c = row.changes as Record<string, unknown>
    switch (row.action) {
      case 'option_added': return `Added ${String(c.label ?? c.value)} (${String(c.kind)})`
      case 'option_updated': return `Changed ${row.remarks ?? 'a list entry'}: ${Object.entries(c).map(([k, v]) => `${k} ${JSON.stringify((v as { from?: unknown }).from)} → ${JSON.stringify((v as { to?: unknown }).to)}`).join(', ')}`
      case 'interest_rate_added': return `Rate ${String(c.ratePct)} % from ${day(String(c.effectiveFrom))}`
      case 'interest_rate_removed': return `Removed the rate from ${day(String(c.effectiveFrom))}`
      default: return row.action.replace(/_/g, ' ')
    }
  }
  return (
    <Panel title="Changes to settings" className="xl:col-span-2" bodyClassName="p-0">
      {query.isLoading ? (
        <div className="p-4"><LoadingBlock rows={3} /></div>
      ) : query.isError ? (
        <div className="p-4"><ErrorState message="The history could not be loaded." onRetry={() => query.refetch()} /></div>
      ) : rows.length === 0 ? (
        <div className="p-4"><EmptyState title="No changes yet" /></div>
      ) : (
        <ul className="hp-scroll max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2">
              <p className="text-[13px] text-slate-800">{describe(row)}</p>
              <p className="text-[11.5px] text-slate-500">{row.actorName} · {when(row.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {query.isFetching && !query.isLoading && <Loader2 className="sr-only" aria-hidden="true" />}
    </Panel>
  )
}
