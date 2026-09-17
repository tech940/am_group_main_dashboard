'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle, Download, Gift, Pencil, Plus, Trash2, X } from 'lucide-react'
import { exchangeBonusSchema } from '@/lib/h-promise/schemas'
import type { HpExchangeBonus } from '@/lib/h-promise/types'
import { toast } from '@/hooks/use-toast'
import { downloadHpExport, hpSend, useBonuses, useHpMutation } from './hp-data'
import { useHpSection } from './hp-context'
import { day, inr } from './hp-format'
import { DateInput, FormField, FormGrid, MoneyInput, SuggestInput, TextArea, TextInput, validate, type FieldErrors } from './hp-form'
import { EmptyState, ErrorState, HpButton, LoadingBlock, Notice, RegPlate } from './hp-ui'

/**
 * The exchange bonus register — a small list the sheet kept on its own tab: which old car was exchanged
 * for which new Tata, and the bonus paid.
 */
export function ExchangeBonusView() {
  const { caps } = useHpSection()
  const query = useBonuses(true)
  const [editing, setEditing] = React.useState<HpExchangeBonus | 'new' | null>(null)
  const remove = useHpMutation((id: string) => hpSend(`/api/h-promise/exchange-bonuses/${id}`, 'DELETE'))
  const rows = query.data?.rows ?? []
  const total = rows.reduce((sum, row) => sum + row.bonusAmount, 0)

  const exportBonuses = () => {
    downloadHpExport('/api/h-promise/export?kind=bonuses').catch((error) =>
      toast({ title: 'The list could not be downloaded', description: error instanceof Error ? error.message : undefined, variant: 'error' }))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · <span className="hp-num font-semibold text-slate-900">{inr(total)}</span> in bonuses
        </p>
        <div className="flex gap-2">
          {rows.length > 0 && <HpButton size="sm" variant="outline" onClick={exportBonuses}><Download /> Excel</HpButton>}
          {caps.register.create && <HpButton size="sm" variant="accent" onClick={() => setEditing('new')}><Plus /> Add exchange bonus</HpButton>}
        </div>
      </div>
      {query.isLoading ? (
        <LoadingBlock label="Loading exchange bonuses" rows={4} />
      ) : query.isError ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Could not load the list.'} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No exchange bonuses yet" icon={<Gift className="h-5 w-5" />}>When a customer exchanges an old car for a new Tata, record the bonus here.</EmptyState>
      ) : (
        <div className="hp-scroll overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="hp-table min-w-[860px]">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Old vehicle</th>
                <th scope="col">New car</th>
                <th scope="col">Consultant</th>
                <th scope="col" className="text-right">Bonus</th>
                <th scope="col">Customer</th>
                <th scope="col">Remarks</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="hp-num whitespace-nowrap">{day(row.entryDate)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <RegPlate regNo={row.vehicleNo} size="sm" />
                      <span className="text-slate-700">{row.vehicleName ?? ''}</span>
                    </div>
                  </td>
                  <td className="font-semibold text-slate-900">{row.newCarModel}</td>
                  <td className="text-slate-700">{row.salesConsultant ?? '—'}</td>
                  <td className="hp-num text-right font-semibold">{inr(row.bonusAmount)}</td>
                  <td className="hp-num text-slate-700">{row.customerPhone ?? '—'}</td>
                  <td className="max-w-[16rem] truncate text-slate-600" title={row.remarks ?? undefined}>{row.remarks ?? ''}</td>
                  <td className="whitespace-nowrap text-right">
                    {caps.register.edit && (
                      <button type="button" onClick={() => setEditing(row)} className="rounded-md p-1.5 hp-hover text-slate-400" aria-label={`Edit the bonus for ${row.vehicleNo}`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    {caps.register.delete && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Delete the exchange bonus for ${row.vehicleNo}?`)) return
                          remove.mutateAsync(row.id).then(
                            () => toast({ title: 'Exchange bonus deleted', variant: 'success' }),
                            (error) => toast({ title: 'Could not delete it', description: error instanceof Error ? error.message : undefined, variant: 'error' }),
                          )
                        }}
                        className="rounded-md p-1.5 hp-hover text-slate-400"
                        aria-label={`Delete the bonus for ${row.vehicleNo}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <BonusDialog bonus={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export function BonusDialog({ bonus, onClose }: { bonus: HpExchangeBonus | null; onClose: () => void }) {
  const { meta, caps } = useHpSection()
  const [values, setValues] = React.useState({
    entryDate: bonus?.entryDate ?? meta?.today ?? '',
    vehicleNo: bonus?.vehicleNo ?? '',
    vehicleName: bonus?.vehicleName ?? '',
    salesConsultant: bonus?.salesConsultant ?? '',
    newCarModel: bonus?.newCarModel ?? '',
    bonusAmount: bonus ? String(bonus.bonusAmount) : '',
    customerPhone: bonus && caps.canSeePii ? bonus.customerPhone ?? '' : '',
    remarks: bonus?.remarks ?? '',
  })
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }))
  const save = useHpMutation((payload: Record<string, unknown>) =>
    bonus ? hpSend(`/api/h-promise/exchange-bonuses/${bonus.id}`, 'PATCH', payload) : hpSend('/api/h-promise/exchange-bonuses', 'POST', payload))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const check = validate(exchangeBonusSchema, values)
    setErrors(check.ok ? {} : check.errors)
    if (!check.ok) return
    try {
      await save.mutateAsync(values)
      toast({ title: bonus ? 'Exchange bonus updated' : 'Exchange bonus added', variant: 'success' })
      onClose()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'It could not be saved.')
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="hp-overlay fixed inset-0 z-50 bg-slate-950/45" />
        <DialogPrimitive.Content className="hp fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl focus:outline-none">
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-slate-900">{bonus ? 'Edit exchange bonus' : 'Add exchange bonus'}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-slate-500">The old car taken in exchange and the bonus given on the new one.</DialogPrimitive.Description>
            </div>
            <FormGrid>
              <FormField label="Date" htmlFor="xb-date" error={errors.entryDate}>
                <DateInput id="xb-date" value={values.entryDate} onValue={set('entryDate')} max={meta?.today} invalid={Boolean(errors.entryDate)} />
              </FormField>
              <FormField label="Old vehicle number" htmlFor="xb-no" required error={errors.vehicleNo}>
                <TextInput id="xb-no" value={values.vehicleNo} onValue={(v) => set('vehicleNo')(v.toUpperCase())} invalid={Boolean(errors.vehicleNo)} className="hp-mono uppercase" />
              </FormField>
              <FormField label="Old vehicle" htmlFor="xb-name" error={errors.vehicleName}>
                <TextInput id="xb-name" value={values.vehicleName} onValue={set('vehicleName')} placeholder="Alto 800" />
              </FormField>
              <FormField label="New car model" htmlFor="xb-model" required error={errors.newCarModel}>
                <SuggestInput id="xb-model" value={values.newCarModel} onValue={set('newCarModel')} suggestions={['Punch', 'Punch EV', 'Nexon', 'Nexon EV', 'Tiago', 'Tiago EV', 'Tigor', 'Altroz', 'Harrier', 'Safari', 'Curvv', 'Curvv EV']} invalid={Boolean(errors.newCarModel)} />
              </FormField>
              <FormField label="Exchange bonus" htmlFor="xb-amount" required error={errors.bonusAmount}>
                <MoneyInput id="xb-amount" value={values.bonusAmount} onValue={set('bonusAmount')} invalid={Boolean(errors.bonusAmount)} />
              </FormField>
              <FormField label="Sales consultant" htmlFor="xb-consultant" error={errors.salesConsultant}>
                <SuggestInput id="xb-consultant" value={values.salesConsultant} onValue={set('salesConsultant')} suggestions={meta?.suggestions.consultants ?? []} />
              </FormField>
              <FormField label="Customer phone" htmlFor="xb-phone" error={errors.customerPhone}
                hint={bonus && !caps.canSeePii ? `On file: ${bonus.customerPhone ?? '—'}` : undefined}>
                <TextInput id="xb-phone" type="tel" inputMode="tel" value={values.customerPhone} onValue={set('customerPhone')} invalid={Boolean(errors.customerPhone)} className="hp-num" />
              </FormField>
              <FormField label="Remarks" htmlFor="xb-remarks" wide>
                <TextArea id="xb-remarks" value={values.remarks} onValue={set('remarks')} rows={2} maxLength={500} />
              </FormField>
            </FormGrid>
            {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
            <div className="flex justify-end gap-2">
              <HpButton variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</HpButton>
              <HpButton type="submit" variant="accent" busy={save.isPending}>{bonus ? 'Save' : 'Add bonus'}</HpButton>
            </div>
          </form>
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
