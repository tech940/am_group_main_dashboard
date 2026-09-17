'use client'

import * as React from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, MapPin, Plus } from 'lucide-react'
import { BrandLogoLockup } from '@/components/brand-logo-lockup'
import { cn } from '@/lib/utils'
import {
  WALK_IN_CUSTOMER_TYPES,
  WALK_IN_INTENTS,
  WALK_IN_LIMITS,
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
} from '@/lib/kia/walk-in-leads/constants'
import { WALK_IN_BACKDATE_DAYS, fieldErrors, walkInSubmitSchema, type FieldErrors } from '@/lib/kia/walk-in-leads/schemas'

/**
 * The no-login Walk-in Register (replaces the Google Form). Built for a phone at the showroom desk:
 * one column, large targets, and "Add another" keeps the consultant and date for the next visitor.
 */

type YesNo = 'yes' | 'no' | ''

type FormState = {
  enquiryDate: string
  consultantName: string
  customerName: string
  mobile: string
  email: string
  address: string
  customerType: '' | (typeof WALK_IN_CUSTOMER_TYPES)[number]
  model: string
  enquirySource: string
  testDrive: YesNo
  exchange: YesNo
  exchangeDetails: string
  remarks: string
  expectedBookingDate: string
  additionalInfo: string
  website: string
}

const CONSULTANT_KEY = 'kia-walk-in-consultant'
const OTHER = '__other__'

function blank(today: string, consultant: string): FormState {
  return {
    enquiryDate: today,
    consultantName: consultant,
    customerName: '',
    mobile: '',
    email: '',
    address: '',
    customerType: '',
    model: '',
    enquirySource: 'WALK IN',
    testDrive: '',
    exchange: '',
    exchangeDetails: '',
    remarks: '',
    expectedBookingDate: '',
    additionalInfo: '',
    website: '',
  }
}

function readSaved(): string {
  try {
    return window.localStorage.getItem(CONSULTANT_KEY) ?? ''
  } catch {
    return ''
  }
}

function save(value: string) {
  try {
    window.localStorage.setItem(CONSULTANT_KEY, value)
  } catch {
    // Private mode or blocked storage: the form still works, it just won't remember the consultant.
  }
}

function minusDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const title = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()

export function WalkInForm({ token, branch, consultants, today }: { token: string; branch: string; consultants: string[]; today: string }) {
  const [form, setForm] = React.useState<FormState>(() => blank(today, ''))
  const [otherConsultant, setOtherConsultant] = React.useState(false)
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent'>('idle')
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [sentName, setSentName] = React.useState('')
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    const saved = readSaved()
    if (!saved) return
    if (consultants.length === 0 || consultants.includes(saved)) {
      setForm((current) => ({ ...current, consultantName: saved }))
    } else {
      setOtherConsultant(true)
      setForm((current) => ({ ...current, consultantName: saved }))
    }
  }, [consultants])

  const set = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const copy = { ...current }
      delete copy[field]
      return copy
    })
    setServerError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError(null)
    const payload = {
      enquiryDate: form.enquiryDate,
      consultantName: form.consultantName,
      customerName: form.customerName,
      mobile: form.mobile,
      email: form.email,
      address: form.address,
      customerType: form.customerType || undefined,
      model: form.model,
      enquirySource: form.enquirySource,
      testDrive: form.testDrive || undefined,
      exchange: form.exchange || undefined,
      exchangeDetails: form.exchangeDetails,
      remarks: form.remarks,
      expectedBookingDate: form.expectedBookingDate,
      additionalInfo: form.additionalInfo,
      website: form.website,
    }
    const checked = walkInSubmitSchema.safeParse(payload)
    if (!checked.success) {
      setErrors(fieldErrors(checked.error))
      setServerError('Check the fields marked in red.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setStatus('sending')
    try {
      const response = await fetch(`/api/walk-in/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: FieldErrors }
      if (!response.ok) {
        if (body.fieldErrors) setErrors(body.fieldErrors)
        setServerError(body.error ?? 'The walk-in could not be saved. Try again.')
        setStatus('idle')
        return
      }
      save(checked.data.consultantName)
      setSentName(checked.data.customerName)
      setStatus('sent')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setServerError('No connection. Check the internet and tap Save again — nothing was lost.')
      setStatus('idle')
    }
  }

  const another = () => {
    setForm(blank(form.enquiryDate, form.consultantName))
    setErrors({})
    setStatus('idle')
  }

  const consultantSelect = otherConsultant ? OTHER : form.consultantName

  return (
    <main className="min-h-dvh bg-slate-100 pb-16 text-slate-900">
      <header className="bg-[#05141f] px-4 pb-8 pt-6 text-white sm:px-6">
        <div className="mx-auto max-w-xl space-y-3">
          <BrandLogoLockup brand="kia" variant="card" size="md" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Walk-in Register</h1>
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
              <MapPin className="h-3.5 w-3.5 text-white/70" aria-hidden="true" />
              {branch} showroom
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 max-w-xl px-3 sm:px-4">
        {status === 'sent' ? (
          <section className="rounded-2xl border border-indigo-200 bg-white p-6 text-center shadow-sm" aria-live="polite">
            <CheckCircle2 className="mx-auto h-12 w-12 text-indigo-600" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">Walk-in saved</h2>
            <p className="mt-1 text-sm text-slate-600">{sentName}’s visit is in the AM Kia dashboard.</p>
            <button
              type="button"
              onClick={another}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add another walk-in
            </button>
          </section>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate className="space-y-3">
            <Group title="Visit">
              <Field label="Date of visit" name="enquiryDate" error={errors.enquiryDate} required>
                <input
                  id="enquiryDate"
                  type="date"
                  value={form.enquiryDate}
                  min={minusDays(today, WALK_IN_BACKDATE_DAYS)}
                  max={today}
                  onChange={(e) => set('enquiryDate', e.target.value)}
                  className={inputClass(errors.enquiryDate)}
                />
              </Field>
              <Field label="Sales consultant" name="consultantName" error={errors.consultantName} required>
                {consultants.length > 0 && (
                  <Select
                    id="consultantName"
                    value={consultantSelect}
                    invalid={Boolean(errors.consultantName)}
                    onChange={(value) => {
                      if (value === OTHER) {
                        setOtherConsultant(true)
                        set('consultantName', '')
                      } else {
                        setOtherConsultant(false)
                        set('consultantName', value)
                      }
                    }}
                  >
                    <option value="">Choose the consultant</option>
                    {consultants.map((name) => <option key={name} value={name}>{name}</option>)}
                    <option value={OTHER}>Someone else — type the name</option>
                  </Select>
                )}
                {(otherConsultant || consultants.length === 0) && (
                  <input
                    id={consultants.length ? 'consultantOther' : 'consultantName'}
                    value={form.consultantName}
                    onChange={(e) => set('consultantName', e.target.value)}
                    maxLength={WALK_IN_LIMITS.consultant}
                    autoComplete="off"
                    placeholder="Consultant's full name"
                    aria-label="Consultant's name"
                    className={cn(inputClass(errors.consultantName), consultants.length > 0 && 'mt-2')}
                  />
                )}
              </Field>
            </Group>

            <Group title="Customer">
              <Field label="Customer name" name="customerName" error={errors.customerName} required>
                <input id="customerName" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} maxLength={WALK_IN_LIMITS.name} autoComplete="off" className={inputClass(errors.customerName)} />
              </Field>
              <Field label="Mobile number" name="mobile" error={errors.mobile} required>
                <div className={cn('flex overflow-hidden rounded-xl border bg-white focus-within:ring-2 focus-within:ring-indigo-500', errors.mobile ? 'border-rose-400' : 'border-slate-300')}>
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-[15px] font-medium text-slate-600">+91</span>
                  <input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    value={form.mobile}
                    onChange={(e) => set('mobile', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 14))}
                    placeholder="98765 43210"
                    className="h-12 min-w-0 flex-1 px-3 text-[16px] tracking-wide outline-none"
                  />
                </div>
              </Field>
              <Field label="New or existing customer" name="customerType" error={errors.customerType} required>
                <Choice
                  name="customerType"
                  value={form.customerType}
                  options={WALK_IN_CUSTOMER_TYPES.map((value) => ({ value, label: title(value) }))}
                  onChange={(value) => set('customerType', value as FormState['customerType'])}
                  invalid={Boolean(errors.customerType)}
                />
              </Field>
              <Field label="E-mail" name="email" error={errors.email} hint="Optional">
                <input id="email" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={WALK_IN_LIMITS.email} className={inputClass(errors.email)} />
              </Field>
              <Field label="Address" name="address" error={errors.address} hint="Optional">
                <textarea id="address" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={WALK_IN_LIMITS.address} className={cn(inputClass(errors.address), 'h-auto py-2.5')} />
              </Field>
            </Group>

            <Group title="Interest">
              <Field label="Model" name="model" error={errors.model} required>
                <div role="radiogroup" aria-label="Model" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {WALK_IN_MODELS.map((model) => (
                    <button
                      key={model}
                      type="button"
                      role="radio"
                      aria-checked={form.model === model}
                      onClick={() => set('model', model)}
                      className={cn(
                        'min-h-11 rounded-xl border px-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        form.model === model ? 'border-[#05141f] bg-[#05141f] text-white' : 'border-slate-300 bg-white text-slate-700',
                        errors.model && !form.model && 'border-rose-300',
                      )}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="How did they come to us?" name="enquirySource" error={errors.enquirySource} required>
                <Select id="enquirySource" value={form.enquirySource} invalid={Boolean(errors.enquirySource)} onChange={(value) => set('enquirySource', value)}>
                  {WALK_IN_SOURCES.map((source) => <option key={source} value={source}>{title(source)}</option>)}
                </Select>
              </Field>
              <Field label="Test drive taken?" name="testDrive" error={errors.testDrive} required>
                <Choice name="testDrive" value={form.testDrive} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} onChange={(value) => set('testDrive', value as YesNo)} invalid={Boolean(errors.testDrive)} />
              </Field>
              <Field label="Exchange car?" name="exchange" error={errors.exchange} required>
                <Choice name="exchange" value={form.exchange} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} onChange={(value) => set('exchange', value as YesNo)} invalid={Boolean(errors.exchange)} />
              </Field>
              {form.exchange === 'yes' && (
                <Field label="Exchange car and year" name="exchangeDetails" error={errors.exchangeDetails} required>
                  <input id="exchangeDetails" value={form.exchangeDetails} onChange={(e) => set('exchangeDetails', e.target.value)} maxLength={WALK_IN_LIMITS.exchangeDetails} placeholder="e.g. Swift 2018" className={inputClass(errors.exchangeDetails)} />
                </Field>
              )}
            </Group>

            <Group title="Follow-up">
              <Field label="What did the customer say?" name="remarks" error={errors.remarks} hint="Tap one, or type your own">
                <div className="-mx-1 mb-2 flex flex-wrap gap-1.5">
                  {WALK_IN_INTENTS.map((intent) => (
                    <button
                      key={intent}
                      type="button"
                      onClick={() => set('remarks', intent)}
                      aria-pressed={form.remarks === intent}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                        form.remarks === intent ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600',
                      )}
                    >
                      {title(intent)}
                    </button>
                  ))}
                </div>
                <input id="remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} maxLength={WALK_IN_LIMITS.remarks} className={inputClass(errors.remarks)} />
              </Field>
              <Field label="Expected booking date" name="expectedBookingDate" error={errors.expectedBookingDate} hint="Optional">
                <input id="expectedBookingDate" type="date" min={form.enquiryDate} value={form.expectedBookingDate} onChange={(e) => set('expectedBookingDate', e.target.value)} className={inputClass(errors.expectedBookingDate)} />
              </Field>
              <Field label="Anything else" name="additionalInfo" error={errors.additionalInfo} hint="Optional — colour, variant, budget, finance">
                <textarea id="additionalInfo" rows={3} value={form.additionalInfo} onChange={(e) => set('additionalInfo', e.target.value)} maxLength={WALK_IN_LIMITS.additionalInfo} className={cn(inputClass(errors.additionalInfo), 'h-auto py-2.5')} />
              </Field>
              {/* Honeypot: hidden from people and screen readers; bots fill it. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
              </div>
            </Group>

            {serverError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {serverError}
              </p>
            )}
            {Object.values(errors).some(Boolean) && !serverError && (
              <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800">Fix the highlighted fields to save.</p>
            )}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="sticky bottom-3 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] py-3.5 text-[16px] font-semibold text-white shadow-lg transition-opacity disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {status === 'sending' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
              {status === 'sending' ? 'Saving…' : 'Save walk-in'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

function inputClass(error?: string) {
  return cn(
    'block h-12 w-full rounded-xl border bg-white px-3 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500',
    error ? 'border-rose-400' : 'border-slate-300',
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <div className="space-y-4">{children}</div>
    </fieldset>
  )
}

function Field({ label, name, error, hint, required, children }: { label: string; name: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div data-field={name}>
      <label htmlFor={name} className="mb-1.5 flex items-baseline justify-between gap-2 text-[14px] font-medium text-slate-800">
        <span>{label}{required && <span className="text-rose-600" aria-hidden="true"> *</span>}</span>
        {hint && <span className="text-[12px] font-normal text-slate-500">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1.5 text-[13px] font-medium text-rose-700" role="alert">{error}</p>}
    </div>
  )
}

function Select({ id, value, onChange, invalid, children }: { id: string; value: string; onChange: (value: string) => void; invalid?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass(invalid ? 'x' : undefined), 'appearance-none pr-9')}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
    </div>
  )
}

function Choice({ name, value, options, onChange, invalid }: { name: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <div id={name} role="radiogroup" className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-12 rounded-xl border text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            value === option.value ? 'border-[#05141f] bg-[#05141f] text-white' : 'border-slate-300 bg-white text-slate-700',
            invalid && !value && 'border-rose-400',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
