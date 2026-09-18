'use client'

import * as React from 'react'
import { AlertCircle, Calendar, CheckCircle2, ChevronDown, Clock, HelpCircle, Loader2, MapPin, Plus, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  WALK_IN_BOOKING_TIMELINES,
  WALK_IN_CUSTOMER_TYPES,
  WALK_IN_HOLDING_REASONS,
  WALK_IN_LIMITS,
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
} from '@/lib/kia/walk-in-leads/constants'
import { WALK_IN_BACKDATE_DAYS, fieldErrors, walkInSubmitSchema, type FieldErrors } from '@/lib/kia/walk-in-leads/schemas'

/**
 * The no-login Walk-in Register (replaces the Google Form). Built for a phone at the showroom desk:
 * one column, large touch targets, mandatory forecasting, follow-up commitments, and "Add another"
 * keeps the consultant and date for the next visitor.
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
  expectedBookingTimeline: '' | (typeof WALK_IN_BOOKING_TIMELINES)[number]
  expectedBookingDate: string
  holdingReason: string
  followUpDate: string
  remarks: string
  additionalInfo: string
  website: string
}

const CONSULTANT_KEY = 'kia-walk-in-consultant'
const OTHER = '__other__'

function plusDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function minusDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function blank(today: string, consultant: string): FormState {
  return {
    enquiryDate: today,
    consultantName: consultant,
    customerName: '',
    mobile: '',
    email: '',
    address: '',
    customerType: 'NEW',
    model: '',
    enquirySource: 'WALK IN',
    testDrive: '',
    exchange: '',
    exchangeDetails: '',
    expectedBookingTimeline: '',
    expectedBookingDate: '',
    holdingReason: '',
    followUpDate: plusDays(today, 2),
    remarks: '',
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
    // Private mode or blocked storage
  }
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

  const pickTimeline = (timeline: (typeof WALK_IN_BOOKING_TIMELINES)[number]) => {
    let suggestedDate = form.expectedBookingDate
    let suggestedHolding = form.holdingReason
    if (timeline === 'Booked today') {
      suggestedDate = form.enquiryDate
      suggestedHolding = ''
    } else if (timeline === 'Within 7 days') {
      suggestedDate = plusDays(form.enquiryDate, 7)
    } else if (timeline === '8 to 30 days') {
      suggestedDate = plusDays(form.enquiryDate, 20)
    } else if (timeline === 'Next month') {
      suggestedDate = plusDays(form.enquiryDate, 35)
    } else if (timeline === '2 to 3 months') {
      suggestedDate = plusDays(form.enquiryDate, 65)
    } else if (timeline === 'No timeline given') {
      suggestedDate = plusDays(form.enquiryDate, 90)
    }
    setForm((current) => ({
      ...current,
      expectedBookingTimeline: timeline,
      expectedBookingDate: suggestedDate,
      holdingReason: suggestedHolding,
    }))
    setErrors((current) => {
      const copy = { ...current }
      delete copy.expectedBookingTimeline
      delete copy.expectedBookingDate
      if (timeline === 'Booked today') delete copy.holdingReason
      return copy
    })
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
      expectedBookingTimeline: form.expectedBookingTimeline || undefined,
      expectedBookingDate: form.expectedBookingDate,
      holdingReason: form.holdingReason || undefined,
      followUpDate: form.followUpDate,
      remarks: form.remarks,
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
      setServerError('No connection. Check the internet and tap Submit again — nothing was lost.')
      setStatus('idle')
    }
  }

  const another = () => {
    setForm(blank(form.enquiryDate, form.consultantName))
    setErrors({})
    setStatus('idle')
  }

  const consultantSelect = otherConsultant ? OTHER : form.consultantName
  const isBookedToday = form.expectedBookingTimeline === 'Booked today'

  return (
    <main className="min-h-dvh bg-slate-100 pb-16 text-slate-900 font-sans">
      <header className="bg-[#05141f] px-4 pb-8 pt-6 text-white sm:px-6">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <img
              src="/brand-logos/am-kia-wide.svg"
              alt="AM Kia"
              className="h-9 sm:h-11 w-auto max-w-[220px] sm:max-w-[260px] object-contain"
            />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
              <MapPin className="h-3.5 w-3.5 text-white/70" aria-hidden="true" />
              {branch} showroom
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Walk-in Register</h1>
            <p className="mt-1 text-xs text-white/70">Showroom visitor entry and follow-up scheduling</p>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 max-w-xl px-3 sm:px-4">
        {status === 'sent' ? (
          <section className="rounded-2xl border border-indigo-200 bg-white p-6 text-center shadow-sm" aria-live="polite">
            <CheckCircle2 className="mx-auto h-12 w-12 text-indigo-600" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-slate-900">Walk-in submitted</h2>
            <p className="mt-1 text-sm text-slate-600">{sentName}’s visit is logged and added to the follow-up pipeline.</p>
            <button
              type="button"
              onClick={another}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Submit another walk-in
            </button>
          </section>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate className="space-y-3">
            {/* 1. VISIT & CONSULTANT */}
            <Group title="1. Visit & Consultant">
              <Field label="Date of visit" name="enquiryDate" error={errors.enquiryDate} required>
                <input
                  id="enquiryDate"
                  type="date"
                  value={form.enquiryDate}
                  min={minusDays(today, WALK_IN_BACKDATE_DAYS)}
                  max={today}
                  onChange={(e) => {
                    const date = e.target.value
                    set('enquiryDate', date)
                    if (date) set('followUpDate', plusDays(date, 2))
                  }}
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

              <Field label="How did they come to us?" name="enquirySource" error={errors.enquirySource} required>
                <Select id="enquirySource" value={form.enquirySource} invalid={Boolean(errors.enquirySource)} onChange={(value) => set('enquirySource', value)}>
                  {WALK_IN_SOURCES.map((source) => <option key={source} value={source}>{title(source)}</option>)}
                </Select>
              </Field>
            </Group>

            {/* 2. CUSTOMER DETAILS */}
            <Group title="2. Customer Details">
              <Field label="Customer name" name="customerName" error={errors.customerName} required>
                <input id="customerName" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} maxLength={WALK_IN_LIMITS.name} autoComplete="off" placeholder="Full name" className={inputClass(errors.customerName)} />
              </Field>

              <Field label="Mobile number" name="mobile" error={errors.mobile} required>
                <div className={cn('flex overflow-hidden rounded-xl border bg-white focus-within:ring-2 focus-within:ring-indigo-500', errors.mobile ? 'border-rose-400' : 'border-slate-300')}>
                  <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-[15px] font-semibold text-slate-600">+91</span>
                  <input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    value={form.mobile}
                    onChange={(e) => set('mobile', e.target.value.replace(/[^\d\s-]/g, '').slice(0, 14))}
                    placeholder="98765 43210"
                    className="h-12 min-w-0 flex-1 px-3 text-[16px] tracking-wide outline-none font-medium"
                  />
                </div>
              </Field>

              <Field
                label="Customer Address / Area"
                name="address"
                error={errors.address}
                hint="Area they live in (e.g. Talab Tillo, Gandhi Nagar, Channi Himmat)"
                required
              >
                <textarea
                  id="address"
                  rows={2}
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  maxLength={WALK_IN_LIMITS.address}
                  placeholder="e.g. Talab Tillo, Gandhi Nagar, Channi Himmat, Sainik Colony..."
                  className={cn(inputClass(errors.address), 'h-auto py-2.5')}
                />
              </Field>

              <Field label="Customer profile" name="customerType" error={errors.customerType} required>
                <Choice
                  name="customerType"
                  value={form.customerType}
                  options={WALK_IN_CUSTOMER_TYPES.map((value) => ({ value, label: title(value) }))}
                  onChange={(value) => set('customerType', value as FormState['customerType'])}
                  invalid={Boolean(errors.customerType)}
                />
              </Field>

              <Field label="E-mail" name="email" error={errors.email} hint="Optional">
                <input id="email" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={WALK_IN_LIMITS.email} placeholder="name@domain.com" className={inputClass(errors.email)} />
              </Field>
            </Group>

            {/* 3. VEHICLE INTEREST & TEST DRIVE */}
            <Group title="3. Vehicle Interest">
              <Field label="Model interested in" name="model" error={errors.model} required>
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
                        form.model === model ? 'border-[#05141f] bg-[#05141f] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                        errors.model && !form.model && 'border-rose-300',
                      )}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Test drive given?" name="testDrive" error={errors.testDrive} required>
                <Choice name="testDrive" value={form.testDrive} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} onChange={(value) => set('testDrive', value as YesNo)} invalid={Boolean(errors.testDrive)} />
              </Field>

              <Field label="Exchange car?" name="exchange" error={errors.exchange} required>
                <Choice name="exchange" value={form.exchange} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} onChange={(value) => set('exchange', value as YesNo)} invalid={Boolean(errors.exchange)} />
              </Field>
              {form.exchange === 'yes' && (
                <Field label="Exchange car model &amp; year" name="exchangeDetails" error={errors.exchangeDetails} required>
                  <input id="exchangeDetails" value={form.exchangeDetails} onChange={(e) => set('exchangeDetails', e.target.value)} maxLength={WALK_IN_LIMITS.exchangeDetails} placeholder="e.g. Swift 2018 / i20 2019" className={inputClass(errors.exchangeDetails)} />
                </Field>
              )}
            </Group>

            {/* 4. FORECASTING & FOLLOW-UP COMMITMENTS */}
            <Group title="4. Forecasting & Follow-up Commitment">
              {/* Timeline forecasting field */}
              <Field
                label="Expected booking timeline (Forecasting)"
                name="expectedBookingTimeline"
                error={errors.expectedBookingTimeline}
                hint="Select buying timeline"
                required
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {WALK_IN_BOOKING_TIMELINES.map((timeline) => {
                    const isSelected = form.expectedBookingTimeline === timeline
                    return (
                      <button
                        key={timeline}
                        type="button"
                        onClick={() => pickTimeline(timeline)}
                        className={cn(
                          'flex min-h-11 items-center justify-center rounded-xl border px-3 py-2 text-center text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                          isSelected
                            ? timeline === 'Booked today'
                              ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                              : 'border-[#05141f] bg-[#05141f] text-white shadow-xs'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                          errors.expectedBookingTimeline && !form.expectedBookingTimeline && 'border-rose-400',
                        )}
                      >
                        {timeline}
                      </button>
                    )
                  })}
                </div>
              </Field>

              {/* Expected booking date (mandatory) */}
              <Field
                label="Expected booking date"
                name="expectedBookingDate"
                error={errors.expectedBookingDate}
                hint="Target conversion date"
                required
              >
                <div className="relative">
                  <input
                    id="expectedBookingDate"
                    type="date"
                    min={form.enquiryDate}
                    value={form.expectedBookingDate}
                    onChange={(e) => set('expectedBookingDate', e.target.value)}
                    className={inputClass(errors.expectedBookingDate)}
                  />
                </div>
              </Field>

              {/* What is holding them back (mandatory unless booked) */}
              {!isBookedToday ? (
                <Field
                  label="What is holding them back?"
                  name="holdingReason"
                  error={errors.holdingReason}
                  hint="Customer's primary hesitation"
                  required
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {WALK_IN_HOLDING_REASONS.map((reason) => {
                      const isSelected = form.holdingReason === reason
                      return (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => set('holdingReason', reason)}
                          className={cn(
                            'flex min-h-11 items-center justify-center rounded-xl border px-2.5 py-2 text-center text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                            isSelected
                              ? 'border-amber-600 bg-amber-500 text-white shadow-xs'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                            errors.holdingReason && !form.holdingReason && 'border-rose-400',
                          )}
                        >
                          {reason}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              ) : (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs font-semibold text-indigo-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" />
                  <span>Customer booked today! No holding hesitation.</span>
                </div>
              )}

              {/* Next follow-up date (mandatory commitment) */}
              <Field
                label="Next follow-up date (Call commitment)"
                name="followUpDate"
                error={errors.followUpDate}
                hint="Default: 2 days after visit"
                required
              >
                <input
                  id="followUpDate"
                  type="date"
                  min={form.enquiryDate}
                  value={form.followUpDate}
                  onChange={(e) => set('followUpDate', e.target.value)}
                  className={inputClass(errors.followUpDate)}
                />
                <p className="mt-1.5 text-[11px] text-slate-500 font-medium">
                  This follow-up date feeds the showroom team&apos;s daily call commitment list.
                </p>
              </Field>

              <Field label="Remarks &amp; notes" name="remarks" error={errors.remarks} hint="Specific requests or notes">
                <input
                  id="remarks"
                  value={form.remarks}
                  onChange={(e) => set('remarks', e.target.value)}
                  maxLength={WALK_IN_LIMITS.remarks}
                  placeholder="e.g. Needs delivery by Diwali, requires ICICI finance, etc."
                  className={inputClass(errors.remarks)}
                />
              </Field>

              <Field label="Anything else" name="additionalInfo" error={errors.additionalInfo} hint="Colour, variant, special terms">
                <textarea
                  id="additionalInfo"
                  rows={2}
                  value={form.additionalInfo}
                  onChange={(e) => set('additionalInfo', e.target.value)}
                  maxLength={WALK_IN_LIMITS.additionalInfo}
                  placeholder="Optional notes..."
                  className={cn(inputClass(errors.additionalInfo), 'h-auto py-2.5')}
                />
              </Field>

              {/* Honeypot */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
              </div>
            </Group>

            {serverError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 font-medium">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {serverError}
              </p>
            )}
            {Object.values(errors).some(Boolean) && !serverError && (
              <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800 font-medium">
                Please fill all mandatory fields marked with an asterisk (*).
              </p>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={status === 'sending'}
              className="sticky bottom-3 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#05141f] py-3.5 text-[16px] font-bold text-white shadow-lg transition-all hover:bg-slate-900 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 cursor-pointer"
            >
              {status === 'sending' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {status === 'sending' ? 'Submitting…' : 'Submit walk in'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

function inputClass(error?: string) {
  return cn(
    'block h-12 w-full rounded-xl border bg-white px-3 text-[15px] font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500',
    error ? 'border-rose-400' : 'border-slate-300',
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden="true" className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <div className="space-y-4">{children}</div>
    </fieldset>
  )
}

function Field({ label, name, error, hint, required, children }: { label: string; name: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div data-field={name}>
      <label htmlFor={name} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13.5px] font-semibold text-slate-800">
        <span>{label}{required && <span className="text-rose-600" aria-hidden="true"> *</span>}</span>
        {hint && <span className="text-[11.5px] font-normal text-slate-500">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1.5 text-[12.5px] font-semibold text-rose-700" role="alert">{error}</p>}
    </div>
  )
}

function Select({ id, value, onChange, invalid, children }: { id: string; value: string; onChange: (value: string) => void; invalid?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass(invalid ? 'x' : undefined), 'appearance-none pr-9 font-semibold text-slate-900')}>
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
            'h-12 rounded-xl border text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
            value === option.value ? 'border-[#05141f] bg-[#05141f] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            invalid && !value && 'border-rose-400',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
