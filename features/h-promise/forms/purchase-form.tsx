'use client'

import * as React from 'react'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NOT_TAKEN } from '@/lib/h-promise/constants'
import { priceWithGstPaise, toPaise } from '@/lib/h-promise/economics'
import { formatStockNo } from '@/lib/h-promise/constants'
import { looksLikeIndianReg, normalizeRegNo } from '@/lib/h-promise/registration'
import { createPurchaseSchema } from '@/lib/h-promise/schemas'
import { isPurchasePriceEditable } from '@/lib/h-promise/status'
import type { HpRegCheck, HpVehicleDetail } from '@/lib/h-promise/types'
import { checkRegistration, hpSend, useHpMutation, useVehicles } from '../hp-data'
import { useHpSection } from '../hp-context'
import { day, inr } from '../hp-format'
import {
  ChoiceChips,
  DateInput,
  FileSlot,
  FormField,
  FormGrid,
  FormSection,
  MoneyInput,
  OptionSelect,
  SuggestInput,
  TextArea,
  TextInput,
  YesNo,
  validate,
  type FieldErrors,
  type StagedFile,
} from '../hp-form'
import { HpButton, Notice, RegPlate } from '../hp-ui'
import { FormFooter } from './form-footer'

type Values = {
  regNo: string
  model: string
  colour: string
  manufacturingYear: string
  odometerKm: string
  engineNo: string
  chassisNo: string
  location: string
  purchaseDate: string
  purchasePrice: string
  purchaseGstPct: string
  expectedProfit: string
  expectedSaleDate: string
  purchaseRemarks: string
  purchaseFinanced: boolean | null
  purchasedBy: string
  salesConsultant: string
  sellerPhone: string
  purchaseWhatsappApprover: string
}

const GST_CHOICES = [
  { value: '0', label: '0 %' },
  { value: '6', label: '6 %' },
  { value: '10', label: '10 %' },
  { value: '12', label: '12 %' },
  { value: '18', label: '18 %' },
] as const

function fromVehicle(v: HpVehicleDetail): Values {
  return {
    regNo: v.regNo,
    model: v.model,
    colour: v.colour ?? '',
    manufacturingYear: v.manufacturingYear ? String(v.manufacturingYear) : '',
    odometerKm: v.odometerKm !== null ? String(v.odometerKm) : '',
    engineNo: v.engineNo ?? '',
    chassisNo: v.chassisNo ?? '',
    location: v.location,
    purchaseDate: v.purchaseDate,
    purchasePrice: String(v.purchasePrice),
    purchaseGstPct: String(v.purchaseGstPct),
    expectedProfit: v.expectedProfit !== null ? String(v.expectedProfit) : '',
    expectedSaleDate: v.expectedSaleDate ?? '',
    purchaseRemarks: v.purchaseRemarks ?? '',
    purchaseFinanced: v.purchaseFinanced,
    purchasedBy: v.purchasedBy,
    salesConsultant: v.salesConsultant ?? '',
    // A masked number is never sent back: the field starts empty and "unchanged" when the viewer cannot see it.
    sellerPhone: v.redacted ? '' : v.sellerPhone ?? '',
    purchaseWhatsappApprover: v.purchaseWhatsappApprover,
  }
}

const EMPTY: Values = {
  regNo: '', model: '', colour: '', manufacturingYear: '', odometerKm: '', engineNo: '', chassisNo: '', location: '',
  purchaseDate: '', purchasePrice: '', purchaseGstPct: '6', expectedProfit: '', expectedSaleDate: '', purchaseRemarks: '', purchaseFinanced: null,
  purchasedBy: '', salesConsultant: '', sellerPhone: '', purchaseWhatsappApprover: '',
}

const FIELD_KEYS = Object.keys(EMPTY) as Array<keyof Values>

/**
 * Record a purchase, or correct one. A rejected purchase is corrected and resubmitted in the same step; an
 * approved purchase keeps its price locked until the MD reopens it.
 */
export function PurchaseForm({ vehicle, onDone, onCancel }: { vehicle?: HpVehicleDetail; onDone: (id: string) => void; onCancel: () => void }) {
  const { meta, caps, openVehicle } = useHpSection()
  const editing = Boolean(vehicle)
  const initial = React.useMemo(() => (vehicle ? fromVehicle(vehicle) : { ...EMPTY, purchaseDate: meta?.today ?? '' }), [vehicle, meta?.today])
  const [values, setValues] = React.useState<Values>(initial)
  const [shot, setShot] = React.useState<StagedFile | null>(null)
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState('')
  const [regResult, setRegResult] = React.useState<{ key: string; result: HpRegCheck } | null>(null)
  const [isCheckingReg, setIsCheckingReg] = React.useState(false)
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }))

  const priceLocked = editing && !isPurchasePriceEditable(vehicle!.purchaseStatus)
  const rejected = editing && vehicle!.purchaseStatus === 'rejected'
  const today = meta?.today
  const existingShot = vehicle?.files.find((file) => file.kind === 'purchase_approval_screenshot') ?? null
  const shotRequired = values.purchaseWhatsappApprover !== '' && values.purchaseWhatsappApprover !== NOT_TAKEN

  const vehiclesQuery = useVehicles('live')
  const liveRows = React.useMemo(() => vehiclesQuery.data?.rows ?? [], [vehiclesQuery.data])

  // Live duplicate check.
  const regKey = normalizeRegNo(values.regNo)
  const shouldCheck = regKey.length >= 4 && !(editing && regKey === normalizeRegNo(vehicle!.regNo))

  React.useEffect(() => {
    if (!shouldCheck) {
      setIsCheckingReg(false)
      return
    }
    let alive = true
    setIsCheckingReg(true)
    const timer = window.setTimeout(() => {
      checkRegistration(regKey, vehicle?.id)
        .then((result) => {
          if (alive) {
            setRegResult({ key: regKey, result })
            setIsCheckingReg(false)
          }
        })
        .catch(() => {
          if (alive) setIsCheckingReg(false)
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [regKey, shouldCheck, vehicle?.id])

  const localDuplicate = React.useMemo(() => {
    if (!regKey || regKey.length < 4) return null
    return liveRows.find((r) => {
      if (editing && r.id === vehicle?.id) return false
      return normalizeRegNo(r.regNo) === regKey && (r.stage === 'in_stock' || r.stage === 'booked' || (r.purchaseStatus !== 'rejected' && !r.saleDate))
    }) ?? null
  }, [liveRows, regKey, editing, vehicle?.id])

  const regCheck = shouldCheck && regResult?.key === regKey ? regResult.result : null
  const duplicateLive: { id: string; stockNo: number; model?: string; stage: string } | null = localDuplicate
    ? { id: localDuplicate.id, stockNo: localDuplicate.stockNo, model: localDuplicate.model, stage: localDuplicate.stage }
    : regCheck?.live
    ? { id: regCheck.live.id, stockNo: regCheck.live.stockNo, model: undefined, stage: regCheck.live.stage }
    : null

  const isDuplicate = Boolean(duplicateLive)

  const withGst = priceWithGstPaise(toPaise(values.purchasePrice), values.purchaseGstPct)

  const mutation = useHpMutation(async (payload: Record<string, unknown>) => {
    if (editing) return hpSend<{ result: { id: string } }>(`/api/h-promise/vehicles/${vehicle!.id}`, 'PATCH', payload)
    return hpSend<{ result: { id: string; stockNo: number } }>('/api/h-promise/vehicles', 'POST', payload)
  }, { meta: true })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const body = {
      ...values,
      purchaseFinanced: values.purchaseFinanced,
      files: shot ? { purchase_approval_screenshot: shot.fileId } : {},
    }
    // Validate the whole purchase with the create schema; a masked phone (redacted viewer) is left alone.
    const check = validate(createPurchaseSchema, editing && vehicle!.redacted && !values.sellerPhone ? { ...body, sellerPhone: '9999999999' } : body)
    const nextErrors: FieldErrors = check.ok ? {} : { ...check.errors }
    if (values.purchaseFinanced === null) nextErrors.purchaseFinanced = 'Say whether the purchase was financed.'
    if (shotRequired && !shot && !existingShot) nextErrors.shot = 'Attach the WhatsApp approval, or choose "Approval not taken on WhatsApp".'
    if (!values.expectedSaleDate) nextErrors.expectedSaleDate = 'Enter the expected sale date.'
    if (today && values.purchaseDate > today) nextErrors.purchaseDate = 'The purchase date cannot be in the future.'
    if (values.expectedSaleDate && values.purchaseDate && values.expectedSaleDate < values.purchaseDate) {
      nextErrors.expectedSaleDate = 'The expected sale date cannot be before the purchase date.'
    }
    if (isDuplicate) {
      nextErrors.regNo = `Duplicate registration! Already on the register as ${formatStockNo(duplicateLive!.stockNo)}.`
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      const first = Object.keys(nextErrors)[0]
      window.document.getElementById(`pf-${first}`)?.focus()
      return
    }

    try {
      if (!editing) {
        const response = await mutation.mutateAsync(body)
        onDone(response.result.id)
        return
      }
      const payload: Record<string, unknown> = { expectedUpdatedAt: vehicle!.updatedAt, files: body.files }
      for (const key of FIELD_KEYS) {
        if (values[key] === initial[key]) continue
        if (key === 'sellerPhone' && vehicle!.redacted && !values.sellerPhone) continue
        if (priceLocked && (key === 'purchasePrice' || key === 'purchaseGstPct')) continue
        payload[key] = values[key]
      }
      if (reason.trim()) payload.remarks = reason.trim()
      if (rejected) payload.resubmit = true
      await mutation.mutateAsync(payload)
      onDone(vehicle!.id)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The purchase could not be saved.')
    }
  }

  const options = meta?.options
  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        {rejected && vehicle!.purchaseDecisionReason && (
          <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>
            <strong className="font-semibold">Rejected by {vehicle!.purchaseDecidedByName ?? 'an approver'}:</strong> {vehicle!.purchaseDecisionReason}
            <span className="mt-0.5 block text-[12px] opacity-80">Correct the details below; saving sends the purchase back for approval.</span>
          </Notice>
        )}
        {priceLocked && (
          <Notice tone="neutral" icon={<Lock className="h-4 w-4" />}>
            The price is locked because the MD approved the purchase. The MD can reopen it if the price was wrong.
          </Notice>
        )}

        <FormSection title="Vehicle">
          <FormGrid>
            <FormField
              label="Registration number"
              htmlFor="pf-regNo"
              required
              error={isDuplicate ? `Already on the register as ${formatStockNo(duplicateLive!.stockNo)}${duplicateLive!.model ? ` (${duplicateLive!.model})` : ''}. Enter a different registration number.` : errors.regNo}
              wide
              hint={!isDuplicate && regCheck?.previous.length
                ? `Bought before as ${regCheck.previous.map((p) => formatStockNo(p.stockNo)).join(', ')} and sold${regCheck.previous[0]?.saleDate ? ` on ${day(regCheck.previous[0].saleDate)}` : ''}.`
                : !isDuplicate && values.regNo && !looksLikeIndianReg(values.regNo) ? 'That does not look like a usual plate — check it before saving.' : undefined}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative max-w-[14rem] flex-1">
                  <TextInput
                    id="pf-regNo"
                    value={values.regNo}
                    onValue={(v) => {
                      set('regNo', v.toUpperCase())
                      if (errors.regNo) setErrors((prev) => ({ ...prev, regNo: undefined as unknown as string }))
                    }}
                    invalid={Boolean(errors.regNo) || isDuplicate}
                    placeholder="JK 02 AB 1234"
                    className={cn("hp-mono uppercase tracking-wider", isCheckingReg && "pr-8")}
                  />
                  {isCheckingReg && (
                    <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    </div>
                  )}
                </div>
                {isCheckingReg ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[11.5px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                    Checking for duplicates…
                  </span>
                ) : normalizeRegNo(values.regNo).length >= 4 ? (
                  <span className="hidden sm:inline-flex"><RegPlate regNo={values.regNo} /></span>
                ) : null}
              </div>
              {isDuplicate && (
                <div className="mt-2.5 rounded-lg border-2 border-rose-500 bg-rose-50 p-3 text-rose-950 dark:bg-rose-950/30 dark:text-rose-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 animate-pulse" />
                      <div className="text-xs">
                        <p className="font-bold text-rose-900">
                          🚨 Duplicate Vehicle Detected: {formatStockNo(duplicateLive!.stockNo)} ({duplicateLive!.model || duplicateLive!.stage})
                        </p>
                        <p className="mt-0.5 text-rose-700">
                          This registration number is already in active stock. All other form fields are locked until you enter a different registration number.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded bg-rose-600 px-2.5 py-1 text-xs font-bold text-white shadow-xs hover:bg-rose-700"
                      onClick={() => openVehicle(duplicateLive!.id)}
                    >
                      View Vehicle
                    </button>
                  </div>
                </div>
              )}
            </FormField>
            <FormField label="Model" htmlFor="pf-model" required error={errors.model}>
              <SuggestInput id="pf-model" value={values.model} onValue={(v) => set('model', v)} suggestions={meta?.suggestions.models ?? []} invalid={Boolean(errors.model)} placeholder="Nexon XZ+" disabled={isDuplicate} />
            </FormField>
            <FormField label="Colour" htmlFor="pf-colour" error={errors.colour}>
              <SuggestInput id="pf-colour" value={values.colour} onValue={(v) => set('colour', v)} suggestions={meta?.suggestions.colours ?? []} disabled={isDuplicate} />
            </FormField>
            <FormField label="Manufacturing year" htmlFor="pf-manufacturingYear" error={errors.manufacturingYear}>
              <TextInput id="pf-manufacturingYear" inputMode="numeric" maxLength={4} value={values.manufacturingYear} onValue={(v) => set('manufacturingYear', v.replace(/\D/g, ''))} invalid={Boolean(errors.manufacturingYear)} className="hp-num" disabled={isDuplicate} />
            </FormField>
            <FormField label="Odometer (km)" htmlFor="pf-odometerKm" error={errors.odometerKm}>
              <TextInput id="pf-odometerKm" inputMode="numeric" value={values.odometerKm} onValue={(v) => set('odometerKm', v.replace(/[^\d,]/g, ''))} invalid={Boolean(errors.odometerKm)} className="hp-num" disabled={isDuplicate} />
            </FormField>
            <FormField label="Engine number" htmlFor="pf-engineNo" error={errors.engineNo}>
              <TextInput id="pf-engineNo" value={values.engineNo} onValue={(v) => set('engineNo', v.toUpperCase())} className="hp-mono uppercase" disabled={isDuplicate} />
            </FormField>
            <FormField label="Chassis number" htmlFor="pf-chassisNo" error={errors.chassisNo}>
              <TextInput id="pf-chassisNo" value={values.chassisNo} onValue={(v) => set('chassisNo', v.toUpperCase())} className="hp-mono uppercase" disabled={isDuplicate} />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Purchase">
          <FormGrid>
            <FormField label="Purchase date" htmlFor="pf-purchaseDate" required error={errors.purchaseDate}>
              <DateInput id="pf-purchaseDate" value={values.purchaseDate} onValue={(v) => set('purchaseDate', v)} max={today} invalid={Boolean(errors.purchaseDate)} disabled={isDuplicate} />
            </FormField>
            <FormField label="Location" htmlFor="pf-location" required error={errors.location}>
              <OptionSelect id="pf-location" options={options?.location ?? []} value={values.location} onValue={(v) => set('location', v)} current={vehicle?.location} invalid={Boolean(errors.location)} placeholder="Choose the location" disabled={isDuplicate} />
            </FormField>
            <FormField label="Purchase price" htmlFor="pf-purchasePrice" required error={errors.purchasePrice}
              hint={withGst !== null ? `With GST: ${inr(withGst / 100)}` : undefined}>
              <MoneyInput id="pf-purchasePrice" value={values.purchasePrice} onValue={(v) => set('purchasePrice', v)} invalid={Boolean(errors.purchasePrice)} disabled={isDuplicate || priceLocked} />
            </FormField>
            <FormField label="GST on purchase" htmlFor="pf-purchaseGstPct" required error={errors.purchaseGstPct}>
              {priceLocked ? (
                <TextInput id="pf-purchaseGstPct" value={`${values.purchaseGstPct} %`} onValue={() => {}} disabled />
              ) : (
                <ChoiceChips id="pf-purchaseGstPct" value={values.purchaseGstPct} onValue={(v) => set('purchaseGstPct', v)} disabled={isDuplicate}
                  options={GST_CHOICES.some((c) => c.value === values.purchaseGstPct) ? GST_CHOICES : [...GST_CHOICES, { value: values.purchaseGstPct, label: `${values.purchaseGstPct} %` }]} />
              )}
            </FormField>
            <FormField label="Bought by" htmlFor="pf-purchasedBy" required error={errors.purchasedBy}
              hint={options && options.staff.length === 0 ? 'No staff names yet — add them in Settings.' : undefined}>
              <OptionSelect id="pf-purchasedBy" options={options?.staff ?? []} value={values.purchasedBy} onValue={(v) => set('purchasedBy', v)} current={vehicle?.purchasedBy} invalid={Boolean(errors.purchasedBy)} placeholder="Choose who bought it" disabled={isDuplicate} />
            </FormField>
            <FormField label="Sales consultant" htmlFor="pf-salesConsultant" error={errors.salesConsultant}>
              <SuggestInput id="pf-salesConsultant" value={values.salesConsultant} onValue={(v) => set('salesConsultant', v)} suggestions={meta?.suggestions.consultants ?? []} disabled={isDuplicate} />
            </FormField>
            <FormField label="Financed purchase" htmlFor="pf-purchaseFinanced" required error={errors.purchaseFinanced}>
              <YesNo id="pf-purchaseFinanced" value={values.purchaseFinanced} onValue={(v) => set('purchaseFinanced', v)} invalid={Boolean(errors.purchaseFinanced)} disabled={isDuplicate} />
            </FormField>
            <FormField label="Expected profit" htmlFor="pf-expectedProfit" error={errors.expectedProfit}>
              <MoneyInput id="pf-expectedProfit" value={values.expectedProfit} onValue={(v) => set('expectedProfit', v)} invalid={Boolean(errors.expectedProfit)} disabled={isDuplicate} />
            </FormField>
            <FormField label="Expected sale date" htmlFor="pf-expectedSaleDate" required error={errors.expectedSaleDate} hint="Target date by which this car must be sold.">
              <DateInput id="pf-expectedSaleDate" value={values.expectedSaleDate} onValue={(v) => set('expectedSaleDate', v)} invalid={Boolean(errors.expectedSaleDate)} disabled={isDuplicate} />
            </FormField>
            <FormField label="Seller's phone" htmlFor="pf-sellerPhone" required={!editing || !vehicle!.redacted} error={errors.sellerPhone}
              hint={editing && vehicle!.redacted ? `On file: ${vehicle!.sellerPhone ?? '—'}. Leave empty to keep it.` : 'Ten digits.'}>
              <TextInput id="pf-sellerPhone" type="tel" inputMode="tel" autoComplete="off" value={values.sellerPhone} onValue={(v) => set('sellerPhone', v)} invalid={Boolean(errors.sellerPhone)} className="hp-num" disabled={isDuplicate} />
            </FormField>
            <FormField label="Remarks" htmlFor="pf-purchaseRemarks" error={errors.purchaseRemarks} wide>
              <TextArea id="pf-purchaseRemarks" value={values.purchaseRemarks} onValue={(v) => set('purchaseRemarks', v)} rows={2} maxLength={1000} disabled={isDuplicate} />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Go-ahead on WhatsApp" description="Who agreed to the purchase before it was made. The in-app approval comes after saving.">
          <FormGrid>
            <FormField label="Approved on WhatsApp by" htmlFor="pf-purchaseWhatsappApprover" required error={errors.purchaseWhatsappApprover}>
              <OptionSelect id="pf-purchaseWhatsappApprover" options={options?.approver ?? []} value={values.purchaseWhatsappApprover} onValue={(v) => set('purchaseWhatsappApprover', v)} current={vehicle?.purchaseWhatsappApprover} withNotTaken invalid={Boolean(errors.purchaseWhatsappApprover)} placeholder="Choose the approver" disabled={isDuplicate} />
            </FormField>
            <div className="sm:col-span-2" id="pf-shot" tabIndex={-1}>
              <FileSlot
                kind="purchase_approval_screenshot"
                label="WhatsApp approval screenshot"
                required={shotRequired}
                existing={existingShot}
                staged={shot}
                onStaged={setShot}
                error={errors.shot}
                disabled={isDuplicate}
              />
            </div>
          </FormGrid>
        </FormSection>

        {editing && (
          <FormSection title="Why the change" description="Optional. Shown in the history next to the change.">
            <TextArea id="pf-reason" value={reason} onValue={setReason} rows={2} maxLength={500} placeholder="e.g. Colour corrected from the RC" disabled={isDuplicate} />
          </FormSection>
        )}

        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending} disabled={isDuplicate || (!caps.register.create && !caps.register.edit)}>
          {editing ? (rejected ? 'Save and resubmit' : 'Save changes') : 'Record purchase'}
        </HpButton>
      </FormFooter>
    </form>
  )
}
