'use client'

import * as React from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NOT_TAKEN, SOLD_TO_LABELS, SOLD_TO_VALUES, type SoldTo } from '@/lib/h-promise/constants'
import { computeEconomics } from '@/lib/h-promise/economics'
import { SALE_FILE_KINDS, saleSchema } from '@/lib/h-promise/schemas'
import { isSalePriceEditable } from '@/lib/h-promise/status'
import type { HpVehicleDetail } from '@/lib/h-promise/types'
import { hpSend, useHpMutation } from '../hp-data'
import { useHpSection } from '../hp-context'
import { day, inrSigned } from '../hp-format'
import {
  ChoiceChips,
  DateInput,
  FileSlot,
  FormField,
  FormGrid,
  FormSection,
  MoneyInput,
  OptionSelect,
  TextArea,
  TextInput,
  YesNo,
  validate,
  type FieldErrors,
  type StagedFile,
} from '../hp-form'
import { HpButton, Notice } from '../hp-ui'
import { FormFooter } from './form-footer'

type SaleFileKind = (typeof SALE_FILE_KINDS)[number]

const SLOT_LABELS: Record<SaleFileKind, string> = {
  buyer_pan: "Buyer's PAN",
  buyer_aadhaar: "Buyer's Aadhaar",
  form_c: 'Form C',
  sale_approval_screenshot: 'WhatsApp approval screenshot',
  gate_pass_photo: 'Gate pass',
}

/**
 * Record the sale, or correct it. Required proof as the sheet enforced: buyer PAN and Aadhaar, the gate pass,
 * and the WhatsApp screenshot unless no WhatsApp approval was taken. A rejected sale is resubmitted by saving.
 */
export function SaleForm({ vehicle, onDone, onCancel }: { vehicle: HpVehicleDetail; onDone: () => void; onCancel: () => void }) {
  const { meta } = useHpSection()
  const recorded = vehicle.saleStatus !== null
  const redacted = vehicle.redacted
  const [values, setValues] = React.useState({
    saleDate: vehicle.saleDate ?? meta?.today ?? '',
    sellingPrice: vehicle.sellingPrice !== null ? String(vehicle.sellingPrice) : '',
    otherCost: vehicle.otherCost ? String(vehicle.otherCost) : '',
    isDemo: recorded ? vehicle.isDemo : null as boolean | null,
    soldTo: (vehicle.soldTo ?? '') as SoldTo | '',
    saleFinanced: recorded ? vehicle.saleFinanced : null as boolean | null,
    soldBy: vehicle.soldBy ?? '',
    buyerName: vehicle.buyerName ?? '',
    buyerPhone: redacted ? '' : vehicle.buyerPhone ?? '',
    buyerAddress: redacted ? '' : vehicle.buyerAddress ?? '',
    saleWhatsappApprover: vehicle.saleWhatsappApprover ?? '',
  })
  const [staged, setStaged] = React.useState<Partial<Record<SaleFileKind, StagedFile>>>({})
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }))

  const priceLocked = recorded && !isSalePriceEditable(vehicle.saleStatus)
  const rejected = vehicle.saleStatus === 'rejected'
  const existing = (kind: SaleFileKind) => (recorded ? vehicle.files.find((file) => file.kind === kind) ?? null : null)
  const shotRequired = values.saleWhatsappApprover !== '' && values.saleWhatsappApprover !== NOT_TAKEN

  const preview = computeEconomics({
    purchasePrice: vehicle.purchasePrice,
    purchaseGstPct: vehicle.purchaseGstPct,
    sellingPrice: values.sellingPrice.replace(/[,\s]/g, '') || null,
    otherCost: values.otherCost.replace(/[,\s]/g, '') || 0,
    purchaseDate: vehicle.purchaseDate,
    saleDate: values.saleDate || null,
    asOfYmd: meta?.today ?? vehicle.purchaseDate,
  }, { interestRates: meta?.rates ?? [], interestRunsTo: 'sale_date' })

  const mutation = useHpMutation((payload: Record<string, unknown>) => hpSend(`/api/h-promise/vehicles/${vehicle.id}/sale`, 'PUT', payload))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const files = Object.fromEntries(Object.entries(staged).map(([kind, file]) => [kind, file!.fileId]))
    const payload: Record<string, unknown> = {
      ...values,
      otherCost: values.otherCost || '0',
      files,
      ...(recorded ? { expectedUpdatedAt: vehicle.updatedAt } : {}),
      ...(reason.trim() ? { remarks: reason.trim() } : {}),
    }
    // A viewer who cannot see the buyer's number keeps the one on file by re-sending nothing new — but the
    // sale form is only offered to people who work the deal, so this is belt and braces.
    const check = validate(saleSchema, payload)
    const next: FieldErrors = check.ok ? {} : { ...check.errors }
    for (const kind of ['buyer_pan', 'buyer_aadhaar', 'gate_pass_photo', 'sale_approval_screenshot'] as const) {
      if (kind === 'sale_approval_screenshot' && !shotRequired) continue
      if (!staged[kind] && !existing(kind)) next[`file.${kind}`] = `Attach the ${SLOT_LABELS[kind].toLowerCase()}.`
    }
    if (meta?.today && values.saleDate > meta.today) next.saleDate = 'The sale date cannot be in the future.'
    if (values.saleDate && values.saleDate < vehicle.purchaseDate) next.saleDate = `The sale cannot be before the purchase (${day(vehicle.purchaseDate)}).`
    setErrors(next)
    if (Object.keys(next).length) {
      window.document.getElementById(`sf-${Object.keys(next)[0].replace('file.', 'file-')}`)?.focus()
      return
    }
    try {
      await mutation.mutateAsync(payload)
      onDone()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The sale could not be saved.')
    }
  }

  const options = meta?.options
  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        {rejected && vehicle.saleDecisionReason && (
          <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>
            <strong className="font-semibold">Sale rejected by {vehicle.saleDecidedByName ?? 'an approver'}:</strong> {vehicle.saleDecisionReason}
            <span className="mt-0.5 block text-[12px] opacity-80">Correct it below; saving sends the sale back for approval.</span>
          </Notice>
        )}
        {priceLocked && (
          <Notice tone="neutral" icon={<Lock className="h-4 w-4" />}>
            The selling price is locked because the sale is approved. Other details can still be corrected; each change is recorded.
          </Notice>
        )}
        {vehicle.booking && !recorded && (
          <Notice tone="booked">Booked on {day(vehicle.booking.bookingDate)} — the booking stays with this sale.</Notice>
        )}

        <FormSection title="Sale">
          <FormGrid>
            <FormField label="Sale date" htmlFor="sf-saleDate" required error={errors.saleDate}>
              <DateInput id="sf-saleDate" value={values.saleDate} onValue={(v) => set('saleDate', v)} min={vehicle.purchaseDate} max={meta?.today} invalid={Boolean(errors.saleDate)} />
            </FormField>
            <FormField label="Sold to" htmlFor="sf-soldTo" required error={errors.soldTo}>
              <ChoiceChips id="sf-soldTo" value={values.soldTo} onValue={(v) => set('soldTo', v)} options={SOLD_TO_VALUES.map((v) => ({ value: v, label: SOLD_TO_LABELS[v] }))} invalid={Boolean(errors.soldTo)} />
            </FormField>
            <FormField label="Selling price" htmlFor="sf-sellingPrice" required error={errors.sellingPrice}>
              <MoneyInput id="sf-sellingPrice" value={values.sellingPrice} onValue={(v) => set('sellingPrice', v)} invalid={Boolean(errors.sellingPrice)} disabled={priceLocked} />
            </FormField>
            <FormField label="Refurbishment / other cost" htmlFor="sf-otherCost" error={errors.otherCost}>
              <MoneyInput id="sf-otherCost" value={values.otherCost} onValue={(v) => set('otherCost', v)} invalid={Boolean(errors.otherCost)} placeholder="0" />
            </FormField>
            <FormField label="Sold by" htmlFor="sf-soldBy" required error={errors.soldBy}>
              <OptionSelect id="sf-soldBy" options={options?.staff ?? []} value={values.soldBy} onValue={(v) => set('soldBy', v)} current={vehicle.soldBy} invalid={Boolean(errors.soldBy)} placeholder="Choose who sold it" />
            </FormField>
            <FormField label="Demo vehicle" htmlFor="sf-isDemo" required error={errors.isDemo}>
              <YesNo id="sf-isDemo" value={values.isDemo} onValue={(v) => set('isDemo', v)} yes="Demo" no="Non-demo" invalid={Boolean(errors.isDemo)} />
            </FormField>
            <FormField label="Financed sale" htmlFor="sf-saleFinanced" required error={errors.saleFinanced}>
              <YesNo id="sf-saleFinanced" value={values.saleFinanced} onValue={(v) => set('saleFinanced', v)} invalid={Boolean(errors.saleFinanced)} />
            </FormField>
          </FormGrid>
          {preview.grossProfitPaise !== null && (
            <div className="hp-accent-soft grid grid-cols-2 gap-3 rounded-lg px-3 py-2.5 sm:grid-cols-4">
              {[
                ['Gross profit', preview.grossProfitPaise],
                ['With GST', preview.grossProfitWithGstPaise],
                [`Interest · ${preview.interestDays ?? 0} d`, preview.interestPaise === null ? null : -preview.interestPaise],
                ['Net profit', preview.netProfitPaise],
              ].map(([label, paise]) => (
                <div key={label as string}>
                  <p className="text-[11px] text-slate-500">{label as string}</p>
                  <p
                    data-tone={(paise as number | null) !== null && (paise as number) < 0 ? 'rejected' : undefined}
                    className={cn('hp-num text-sm font-semibold', (paise as number | null) !== null && (paise as number) < 0 ? 'hp-tone-text' : 'text-slate-900')}
                  >
                    {paise === null ? '—' : inrSigned((paise as number) / 100)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </FormSection>

        <FormSection title="Buyer" description={values.soldTo === 'BROKER' ? 'The broker who bought it.' : values.soldTo === 'SCRAP' ? 'The scrap dealer.' : undefined}>
          <FormGrid>
            <FormField label="Name" htmlFor="sf-buyerName" required error={errors.buyerName}>
              <TextInput id="sf-buyerName" value={values.buyerName} onValue={(v) => set('buyerName', v)} invalid={Boolean(errors.buyerName)} />
            </FormField>
            <FormField label="Phone" htmlFor="sf-buyerPhone" required error={errors.buyerPhone}
              hint={redacted && recorded ? `On file: ${vehicle.buyerPhone ?? '—'}` : 'Ten digits.'}>
              <TextInput id="sf-buyerPhone" type="tel" inputMode="tel" value={values.buyerPhone} onValue={(v) => set('buyerPhone', v)} invalid={Boolean(errors.buyerPhone)} className="hp-num" />
            </FormField>
            <FormField label="Address" htmlFor="sf-buyerAddress" error={errors.buyerAddress} wide>
              <TextArea id="sf-buyerAddress" value={values.buyerAddress} onValue={(v) => set('buyerAddress', v)} rows={2} maxLength={500} />
            </FormField>
          </FormGrid>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['buyer_pan', 'buyer_aadhaar', 'form_c'] as const).map((kind) => (
              <div key={kind} id={`sf-file-${kind}`} tabIndex={-1}>
                <FileSlot kind={kind} label={SLOT_LABELS[kind]} required={kind !== 'form_c'} existing={existing(kind)} staged={staged[kind] ?? null}
                  onStaged={(file) => setStaged((current) => ({ ...current, [kind]: file ?? undefined }))} error={errors[`file.${kind}`]} />
              </div>
            ))}
          </div>
        </FormSection>

        <FormSection title="Approval and gate pass">
          <FormGrid>
            <FormField label="Approved on WhatsApp by" htmlFor="sf-saleWhatsappApprover" required error={errors.saleWhatsappApprover}>
              <OptionSelect id="sf-saleWhatsappApprover" options={options?.approver ?? []} value={values.saleWhatsappApprover} onValue={(v) => set('saleWhatsappApprover', v)} current={vehicle.saleWhatsappApprover} withNotTaken invalid={Boolean(errors.saleWhatsappApprover)} placeholder="Choose the approver" />
            </FormField>
          </FormGrid>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['sale_approval_screenshot', 'gate_pass_photo'] as const).map((kind) => (
              <div key={kind} id={`sf-file-${kind}`} tabIndex={-1}>
                <FileSlot kind={kind} label={SLOT_LABELS[kind]} required={kind === 'gate_pass_photo' || shotRequired} existing={existing(kind)} staged={staged[kind] ?? null}
                  onStaged={(file) => setStaged((current) => ({ ...current, [kind]: file ?? undefined }))} error={errors[`file.${kind}`]} />
              </div>
            ))}
          </div>
        </FormSection>

        {recorded && (
          <FormSection title="Why the change" description="Optional. Shown in the history next to the change.">
            <TextArea id="sf-reason" value={reason} onValue={setReason} rows={2} maxLength={500} />
          </FormSection>
        )}
        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter note={!recorded ? 'Once saved, the sale goes to the GSM / SM, then the MD.' : undefined}>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending}>
          {!recorded ? 'Record sale' : rejected ? 'Save and resubmit' : 'Save changes'}
        </HpButton>
      </FormFooter>
    </form>
  )
}
