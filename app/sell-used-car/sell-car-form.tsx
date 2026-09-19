'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  EVALUATION_WINDOW_DAYS,
  MORE_BRANDS,
  OLDEST_YEAR,
  PRIMARY_BRANDS,
  RECENT_YEAR_COUNT,
  addDays,
  currentIndiaYear,
  formatDay,
  formatKm,
  indiaToday,
  modelsForBrand,
} from '@/lib/evaluation/catalog'
import { EvaluationSubmitSchema, fieldErrors } from '@/lib/evaluation/types'
import styles from './sell-used-car.module.css'

/*
 * Three steps, each answered mostly by tapping: the car (brand → model → year), the details (a day, new-car
 * interest, kilometres — the one keyboard field last, so it doesn't cover the taps), then who to call. What the
 * customer has told us rides along at the top as a slip they can tap to change. No price is shown: the evaluator
 * gives it after seeing the car.
 *
 * Phones: every step is a browser history entry, so Android's back gesture steps back through the form instead
 * of dropping the customer out to WhatsApp; the answers are kept in sessionStorage so a reload or a tab the
 * phone discarded comes back where it was.
 */

type Stage = 'car' | 'details' | 'contact' | 'done'
type CarStep = 'brand' | 'more' | 'model' | 'year'
type FieldKey =
  | 'brand'
  | 'model'
  | 'manufacturingYear'
  | 'kilometres'
  | 'evaluationDate'
  | 'interestedInNewCar'
  | 'customerName'
  | 'mobile'

const STAGE_TITLES: Record<Exclude<Stage, 'done'>, string> = { car: 'Your car', details: 'Details', contact: 'Your number' }
const STAGE_ORDER: Exclude<Stage, 'done'>[] = ['car', 'details', 'contact']
/** Where each screen sits along the whole form, so the bar moves on every tap — not once per three screens. */
const POSITION: Record<string, number> = { 'car:brand': 0, 'car:more': 0.5, 'car:model': 1, 'car:year': 2, 'details:': 3, 'contact:': 4 }
const POSITION_COUNT = 5
const MODEL_PREVIEW = 12
/** After this hour (IST) the evaluator can't reach a customer the same day, so "Today" isn't offered. */
const LAST_SAME_DAY_HOUR = 17
const DRAFT_KEY = 'am-sell-used-car:v1'
const NARROW = '(max-width: 899px)'

const CAR_FIELDS = new Set<string>(['brand', 'model', 'manufacturingYear'])
const DETAIL_FIELDS = new Set<string>(['kilometres', 'evaluationDate', 'interestedInNewCar'])
/** The order a customer meets the fields in, so focus goes to the first problem on the screen. */
const FIELD_ORDER: FieldKey[] = ['brand', 'model', 'manufacturingYear', 'evaluationDate', 'interestedInNewCar', 'kilometres', 'customerName', 'mobile']

const DetailsSchema = EvaluationSubmitSchema.pick({ kilometres: true, evaluationDate: true, interestedInNewCar: true })

function cx(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(' ')
}

/** Google Tag Manager's queue. Created if GTM has not loaded (e.g. blocked), so a push never throws. */
function pushDataLayer(event: Record<string, unknown>) {
  const w = window as unknown as { dataLayer?: unknown[] }
  w.dataLayer = w.dataLayer || []
  w.dataLayer.push(event)
}

function stepKey(stage: Stage, carStep: CarStep): string {
  return stage === 'car' ? `car:${carStep}` : `${stage}:`
}

function indiaHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()))
}

function spacedMobile(digits: string): string {
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits
}

/** A short code the customer can quote on the call; the desk's email carries the same one. */
function referenceOf(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

/** "R. K. Sharma" → "R. K. Sharma"; "Rahul Sharma" → "Rahul". Initials alone make a strange greeting. */
function greetingName(name: string): string {
  const full = name.trim().replace(/\s+/g, ' ')
  const first = full.split(' ')[0]?.replace(/\.+$/, '') ?? ''
  return first.length > 2 ? first : full
}

type Draft = {
  stage: Exclude<Stage, 'done'>
  carStep: CarStep
  brand: string
  brandFromMore: boolean
  brandTyped: boolean
  model: string
  modelTyped: boolean
  year: number | null
  km: string
  date: string
  newCar: boolean | null
  name: string
  phone: string
}

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Partial<Draft>
    if (!draft || typeof draft !== 'object' || typeof draft.brand !== 'string') return null
    return draft as Draft
  } catch {
    return null
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else window.sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Private mode or storage blocked: the form still works, it just won't survive a reload.
  }
}

export function SellCarForm() {
  const [stage, setStage] = useState<Stage>('car')
  const [carStep, setCarStep] = useState<CarStep>('brand')

  const [brand, setBrand] = useState('')
  const [brandFromMore, setBrandFromMore] = useState(false)
  const [brandTyped, setBrandTyped] = useState(false)
  const [model, setModel] = useState('')
  const [modelTyped, setModelTyped] = useState(false)
  const [allModels, setAllModels] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [olderOpen, setOlderOpen] = useState(false)

  const [km, setKm] = useState('')
  const [date, setDate] = useState('')
  const [otherDayOpen, setOtherDayOpen] = useState(false)
  const [newCar, setNewCar] = useState<boolean | null>(null)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState<{ id: string; mobile: string } | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)

  const campaign = useRef<{ utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }>({
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
  })
  const cardRef = useRef<HTMLDivElement>(null)
  const questionRef = useRef<HTMLHeadingElement>(null)
  const kmRef = useRef<HTMLInputElement>(null)
  const kmCaret = useRef<number | null>(null)
  const moved = useRef(false)
  const historyIndex = useRef(0)
  const doneRef = useRef(false)
  const restored = useRef(false)
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null)
  // The step entrance animates only once the customer has moved; the first paint is already at rest.
  const [hasMoved, setHasMoved] = useState(false)

  // ── Campaign tags and a saved draft, once, after the page is interactive ─────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    campaign.current = {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    }
    const draft = readDraft()
    restored.current = true
    if (!draft) return
    // A restored draft is applied in one go after mount; the first paint stays the plain brand step.
    /* eslint-disable react-hooks/set-state-in-effect */
    setBrand(draft.brand)
    setBrandFromMore(Boolean(draft.brandFromMore))
    setBrandTyped(Boolean(draft.brandTyped))
    setModel(typeof draft.model === 'string' ? draft.model : '')
    setModelTyped(Boolean(draft.modelTyped))
    setYear(typeof draft.year === 'number' ? draft.year : null)
    setKm(typeof draft.km === 'string' ? draft.km.replace(/\D/g, '').slice(0, 6) : '')
    setDate(typeof draft.date === 'string' && draft.date >= indiaToday() ? draft.date : '')
    setNewCar(typeof draft.newCar === 'boolean' ? draft.newCar : null)
    setName(typeof draft.name === 'string' ? draft.name : '')
    setPhone(typeof draft.phone === 'string' ? draft.phone : '')
    if (draft.stage && draft.stage !== 'car') {
      moved.current = true
      setStage(draft.stage)
    } else if (draft.carStep && draft.carStep !== 'brand') {
      moved.current = true
      setCarStep(draft.carStep)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (!restored.current) return
    if (stage === 'done' || (!brand && !brandTyped)) {
      if (stage === 'done') writeDraft(null)
      return
    }
    writeDraft({ stage, carStep, brand, brandFromMore, brandTyped, model, modelTyped, year, km, date, newCar, name, phone })
  }, [stage, carStep, brand, brandFromMore, brandTyped, model, modelTyped, year, km, date, newCar, name, phone])

  // ── Back button / gesture ─────────────────────────────────────────────────────────────────────
  // Each step is pushed WITHOUT a URL: Next.js only turns a userland pushState into a server round trip when a
  // URL is passed. On popstate our entries are handled here, in the capture phase, before Next's own listener
  // would treat them as a navigation.
  useEffect(() => {
    function onPop(event: PopStateEvent) {
      const state = event.state as { sellStep?: string; sellIndex?: number } | null
      if (!state || typeof state.sellStep !== 'string') return
      event.stopImmediatePropagation()
      if (doneRef.current) {
        // Finished: back leaves the page rather than reopening the form.
        window.history.go(-((state.sellIndex ?? 0) + 1))
        return
      }
      historyIndex.current = state.sellIndex ?? 0
      const [nextStage, nextCarStep] = state.sellStep.split(':') as [Stage, CarStep | '']
      moved.current = true
      setErrors({})
      setFormError('')
      setStage(nextStage)
      if (nextCarStep) setCarStep(nextCarStep)
    }
    window.addEventListener('popstate', onPop, true)
    return () => window.removeEventListener('popstate', onPop, true)
  }, [])

  function go(next: Stage, nextCarStep?: CarStep) {
    moved.current = true
    setHasMoved(true)
    setFormError('')
    setStage(next)
    if (nextCarStep) setCarStep(nextCarStep)
    try {
      const current = window.history.state as { sellStep?: string } | null
      if (!current || typeof current.sellStep !== 'string') {
        window.history.replaceState({ ...(current ?? {}), sellStep: stepKey(stage, carStep), sellIndex: 0 }, '')
        historyIndex.current = 0
      }
      historyIndex.current += 1
      window.history.pushState(
        { ...(window.history.state ?? {}), sellStep: stepKey(next, nextCarStep ?? carStep), sellIndex: historyIndex.current },
        '',
      )
    } catch {
      // History unavailable (very old webview): the on-screen Back still works.
    }
  }

  function back() {
    setErrors({})
    const state = (typeof window !== 'undefined' ? window.history.state : null) as { sellIndex?: number } | null
    if (state && typeof state.sellIndex === 'number' && state.sellIndex > 0) {
      window.history.back()
      return
    }
    if (stage === 'contact') return go('details')
    if (stage === 'details') return go('car', 'year')
    if (carStep === 'year') return go('car', 'model')
    if (carStep === 'model') return go('car', brandFromMore ? 'more' : 'brand')
    if (carStep === 'more') return go('car', 'brand')
  }

  // ── Focus and scroll: every new screen starts at its question (or its first field) ─────────────
  // The jump is instant: the screen's content has just been swapped, so an animated scroll would only move
  // the reader through content they didn't ask to see.
  useEffect(() => {
    if (!moved.current) return
    const card = cardRef.current
    const auto = card?.querySelector<HTMLElement>('[data-autofocus]')
    ;(auto ?? questionRef.current)?.focus({ preventScroll: true })
    if (card && window.matchMedia(NARROW).matches) {
      const top = card.getBoundingClientRect().top
      if (Math.abs(top - 8) > 4) window.scrollTo({ top: window.scrollY + top - 8, behavior: 'auto' })
    } else if (card && card.getBoundingClientRect().top < 0) {
      card.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
  }, [stage, carStep])

  // Revealed-in-place content takes focus, so a keyboard or screen-reader user isn't dropped to <body>.
  useEffect(() => {
    if (!moved.current) return
    cardRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [modelTyped, allModels, olderOpen, otherDayOpen])

  useEffect(() => {
    if (!focusTarget) return
    const el = document.getElementById(focusTarget.id)
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [focusTarget])

  useLayoutEffect(() => {
    const el = kmRef.current
    const wanted = kmCaret.current
    if (!el || wanted === null) return
    kmCaret.current = null
    let pos = 0
    let seen = 0
    while (pos < el.value.length && seen < wanted) {
      if (/\d/.test(el.value[pos])) seen += 1
      pos += 1
    }
    el.setSelectionRange(pos, pos)
  }, [km])

  // ── Dates are worked out when the details step opens, never on the server (no stale "today"). ──
  const today = useMemo(() => (stage === 'details' ? indiaToday() : ''), [stage])
  const dayOptions = useMemo(() => {
    if (!today) return []
    const start = indiaHour() >= LAST_SAME_DAY_HOUR ? 1 : 0
    return Array.from({ length: 7 }, (_, i) => addDays(today, start + i))
  }, [today])
  const years = useMemo(() => {
    if (stage !== 'car' || carStep !== 'year') return { recent: [] as number[], older: [] as number[] }
    const newest = currentIndiaYear()
    const recent = Array.from({ length: RECENT_YEAR_COUNT }, (_, i) => newest - i)
    const older: number[] = []
    for (let y = newest - RECENT_YEAR_COUNT; y >= OLDEST_YEAR; y -= 1) older.push(y)
    return { recent, older }
  }, [stage, carStep])
  const oldestRecent = years.recent.at(-1) ?? 0
  const olderChosen = year !== null && oldestRecent > 0 && year < oldestRecent

  const catalogueModels = brandTyped ? [] : modelsForBrand(brand)
  const chosenBeyondPreview = Boolean(model) && !modelTyped && catalogueModels.indexOf(model) >= MODEL_PREVIEW
  const visibleModels = allModels || chosenBeyondPreview ? catalogueModels : catalogueModels.slice(0, MODEL_PREVIEW)

  // ── Errors ────────────────────────────────────────────────────────────────────────────────────
  function clearError(key: FieldKey) {
    setErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev))
  }

  function fieldElementId(key: string): string {
    switch (key) {
      case 'brand':
        return 'sell-brand'
      case 'model':
        return modelTyped || brandTyped ? 'sell-model' : 'sell-model-first'
      case 'manufacturingYear':
        return 'sell-year-first'
      case 'evaluationDate':
        return otherDayOpen ? 'sell-date' : 'sell-day-first'
      case 'interestedInNewCar':
        return 'sell-newcar-yes'
      case 'kilometres':
        return 'sell-km'
      case 'customerName':
        return 'sell-name'
      default:
        return 'sell-mobile'
    }
  }

  /** Shows the messages and moves focus to the first field with a problem — on its own screen if need be. */
  function showErrors(next: Record<string, string>) {
    setErrors(next)
    const first = FIELD_ORDER.find((key) => next[key])
    if (!first) return
    if (CAR_FIELDS.has(first) && stage !== 'car') {
      go('car', first === 'manufacturingYear' ? 'year' : 'model')
    } else if (DETAIL_FIELDS.has(first) && stage !== 'details') {
      go('details')
    }
    setFocusTarget((prev) => ({ id: fieldElementId(first), n: (prev?.n ?? 0) + 1 }))
  }

  // ── Choices ───────────────────────────────────────────────────────────────────────────────────
  function chooseBrand(value: string, fromMore: boolean) {
    if (value !== brand || brandTyped) {
      setModel('')
      setModelTyped(false)
      setAllModels(false)
    }
    setBrand(value)
    setBrandFromMore(fromMore)
    setBrandTyped(false)
    setErrors({})
    go('car', 'model')
  }

  function typeBrand() {
    if (!brandTyped) {
      setBrand('')
      setModel('')
    }
    setBrandTyped(true)
    setBrandFromMore(true)
    setModelTyped(true)
    setErrors({})
    go('car', 'model')
  }

  function chooseModel(value: string) {
    setModel(value)
    setModelTyped(false)
    setErrors({})
    go('car', 'year')
  }

  function typeModel() {
    if (!modelTyped) setModel('')
    moved.current = true
    setModelTyped(true)
    setErrors({})
  }

  function chooseYear(value: number) {
    setYear(value)
    setErrors({})
    go('details')
  }

  function onKmChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    const caret = event.target.selectionStart ?? raw.length
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    // Refuse the keystroke rather than silently dropping the last digit.
    if (digits.length > 6) return
    kmCaret.current = raw.slice(0, caret).replace(/\D/g, '').length
    setKm(digits)
    clearError('kilometres')
  }

  // ── Step submits ──────────────────────────────────────────────────────────────────────────────
  function submitTypedCar() {
    const next: Record<string, string> = {}
    if (brandTyped && !brand.trim()) next.brand = 'Type your car’s brand.'
    if (!model.trim()) next.model = 'Type your car’s model.'
    if (Object.keys(next).length) return showErrors(next)
    setErrors({})
    go('car', 'year')
  }

  function submitDetails() {
    const parsed = DetailsSchema.safeParse({
      kilometres: km === '' ? undefined : Number(km),
      evaluationDate: date,
      interestedInNewCar: newCar ?? undefined,
    })
    if (!parsed.success) return showErrors(fieldErrors(parsed.error))
    setErrors({})
    go('contact')
  }

  async function submitLead() {
    const payload = {
      customerName: name,
      mobile: phone,
      brand,
      model,
      manufacturingYear: year,
      kilometres: km === '' ? undefined : Number(km),
      evaluationDate: date,
      interestedInNewCar: newCar ?? undefined,
      correctionOf: correcting,
      ...campaign.current,
    }
    const parsed = EvaluationSubmitSchema.safeParse(payload)
    if (!parsed.success) return showErrors(fieldErrors(parsed.error))
    setSubmitting(true)
    setFormError('')
    try {
      const response = await fetch('/api/evaluations/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, website }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        id?: string
        error?: string
        fieldErrors?: Record<string, string>
      }
      if (response.ok && body.ok) {
        // Google Tag Manager conversion (google-tag-manager.tsx). A number correction is the SAME person
        // resubmitting, so it is not a second lead. No personal data — never the name or mobile.
        if (!correcting) pushDataLayer({ event: 'sell_car_lead', car_brand: parsed.data.brand, interested_in_new_car: parsed.data.interestedInNewCar ?? null })
        setSent({ id: body.id ?? '', mobile: parsed.data.mobile })
        setCorrecting(null)
        setErrors({})
        doneRef.current = true
        go('done')
        return
      }
      if (body.fieldErrors && Object.keys(body.fieldErrors).length) return showErrors(body.fieldErrors)
      setFormError(body.error || 'We couldn’t send that. Please try again.')
    } catch {
      setFormError('We couldn’t send that — check your internet connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (stage === 'car' && carStep === 'model') submitTypedCar()
    else if (stage === 'car' && carStep === 'year' && olderChosen) go('details')
    else if (stage === 'details') submitDetails()
    else if (stage === 'contact') void submitLead()
  }

  function fixNumber() {
    doneRef.current = false
    setCorrecting(sent?.id || null)
    setFocusTarget((prev) => ({ id: 'sell-mobile', n: (prev?.n ?? 0) + 1 }))
    go('contact')
  }

  function startOver() {
    doneRef.current = false
    setBrand('')
    setBrandTyped(false)
    setBrandFromMore(false)
    setModel('')
    setModelTyped(false)
    setAllModels(false)
    setYear(null)
    setOlderOpen(false)
    setKm('')
    setDate('')
    setOtherDayOpen(false)
    setNewCar(null)
    setErrors({})
    setCorrecting(null)
    go('car', 'brand')
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────────────
  const stageIndex = stage === 'done' ? 3 : STAGE_ORDER.indexOf(stage) + 1
  const position = POSITION[stepKey(stage, carStep)] ?? 0
  const canGoBack = stage === 'details' || stage === 'contact' || (stage === 'car' && carStep !== 'brand')
  const carName = [year, brand, model].filter(Boolean).join(' ')
  const stepPrefix = stage === 'done' ? '' : `Step ${stageIndex} of 3. `
  const stepClass = cx(styles.step, hasMoved && styles.stepIn)

  const slipItems: Array<{ key: 'brand' | 'model' | 'year' | 'km'; label: string; value: string }> = []
  if (stage !== 'done') {
    if (brand) slipItems.push({ key: 'brand', label: 'brand', value: brand })
    if (model && !(stage === 'car' && carStep === 'model' && modelTyped)) slipItems.push({ key: 'model', label: 'model', value: model })
    if (year && stage !== 'car') slipItems.push({ key: 'year', label: 'year', value: String(year) })
    if (km && stage === 'contact') slipItems.push({ key: 'km', label: 'kilometres', value: `${formatKm(Number(km))} km` })
  }

  function editSlip(key: 'brand' | 'model' | 'year' | 'km') {
    setErrors({})
    if (key === 'brand') go('car', brandFromMore ? 'more' : 'brand')
    else if (key === 'model') go('car', 'model')
    else if (key === 'year') go('car', 'year')
    else go('details')
  }

  const question = (text: string) => (
    <h2 ref={questionRef} tabIndex={-1} className={styles.question}>
      <span className={styles.srOnly}>{stepPrefix}</span>
      {text}
    </h2>
  )

  return (
    <div ref={cardRef} className={styles.card}>
      {stage !== 'done' ? (
        <>
          <div className={styles.cardTop}>
            <p className={styles.stepLabel} aria-hidden="true">
              Step {stageIndex} of 3 · {STAGE_TITLES[stage]}
            </p>
            {canGoBack ? (
              <button type="button" className={styles.back} onClick={back}>
                Back
              </button>
            ) : null}
          </div>
          <div className={styles.progress} aria-hidden="true">
            <span className={styles.progressFill} style={{ transform: `scaleX(${(position + 1) / POSITION_COUNT})` }} />
          </div>
          {slipItems.length ? (
            <div className={styles.slip}>
              <div className={styles.slipClip}>
                <ul className={styles.slipList} aria-label="Your car so far">
                  {slipItems.map((item) => (
                    <li key={item.key} className={styles.slipItem}>
                      <button type="button" className={styles.slipButton} onClick={() => editSlip(item.key)}>
                        <span className={styles.srOnly}>Change {item.label}: </span>
                        {item.value}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <form noValidate onSubmit={onSubmit}>
        {/* People never see this; form-filling bots do. */}
        <div className={styles.trap} aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>

        {stage === 'car' && carStep === 'brand' ? (
          <div key="brand" className={stepClass}>
            {question('Which car do you have?')}
            <div className={styles.tiles} role="group" aria-label="Brand">
              {PRIMARY_BRANDS.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className={cx(styles.tile, brand === b.name && !brandTyped && !brandFromMore && styles.chosen)}
                  aria-pressed={brand === b.name && !brandTyped && !brandFromMore}
                  onClick={() => chooseBrand(b.name, false)}
                >
                  {b.name}
                </button>
              ))}
              <button
                type="button"
                className={cx(styles.tile, styles.quiet, brandFromMore && Boolean(brand || brandTyped) && styles.chosen)}
                aria-pressed={brandFromMore && Boolean(brand || brandTyped)}
                onClick={() => go('car', 'more')}
              >
                Other brand
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'car' && carStep === 'more' ? (
          <div key="more" className={stepClass}>
            {question('Which brand?')}
            <div className={styles.chips} role="group" aria-label="Brand">
              {MORE_BRANDS.map((b) => (
                <button
                  key={b.name}
                  type="button"
                  className={cx(styles.chip, brand === b.name && !brandTyped && styles.chosen)}
                  aria-pressed={brand === b.name && !brandTyped}
                  onClick={() => chooseBrand(b.name, true)}
                >
                  {b.name}
                </button>
              ))}
              <button
                type="button"
                className={cx(styles.chip, styles.quiet, brandTyped && styles.chosen)}
                aria-pressed={brandTyped}
                onClick={typeBrand}
              >
                Not listed
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'car' && carStep === 'model' ? (
          <div key="model" className={stepClass}>
            {question(brandTyped ? 'Tell us your car' : `Which ${brand}?`)}

            {!brandTyped ? (
              <div className={styles.chips} role="group" aria-label={`${brand} model`}>
                {visibleModels.map((m, i) => (
                  <button
                    key={m}
                    id={i === 0 ? 'sell-model-first' : undefined}
                    type="button"
                    className={cx(styles.chip, model === m && !modelTyped && styles.chosen)}
                    aria-pressed={model === m && !modelTyped}
                    data-autofocus={allModels && i === MODEL_PREVIEW ? true : undefined}
                    onClick={() => chooseModel(m)}
                  >
                    {m}
                  </button>
                ))}
                {visibleModels.length < catalogueModels.length ? (
                  <button
                    type="button"
                    className={cx(styles.chip, styles.quiet)}
                    onClick={() => {
                      moved.current = true
                      setAllModels(true)
                    }}
                  >
                    {catalogueModels.length - visibleModels.length} more {brand} models
                  </button>
                ) : null}
                <button
                  type="button"
                  className={cx(styles.chip, styles.quiet, modelTyped && styles.chosen)}
                  aria-pressed={modelTyped}
                  onClick={typeModel}
                >
                  Other model
                </button>
              </div>
            ) : null}

            {brandTyped ? (
              <TextField
                id="sell-brand"
                label="Brand"
                value={brand}
                onChange={(value) => {
                  setBrand(value)
                  clearError('brand')
                }}
                error={errors.brand}
                autoComplete="off"
                maxLength={40}
                autoFocus
              />
            ) : null}
            {modelTyped ? (
              <>
                <TextField
                  id="sell-model"
                  label="Model"
                  value={model}
                  onChange={(value) => {
                    setModel(value)
                    clearError('model')
                  }}
                  error={errors.model}
                  autoComplete="off"
                  maxLength={60}
                  autoFocus={!brandTyped}
                  placeholder={brandTyped ? undefined : `Your ${brand} model`}
                />
                <button type="submit" className={styles.primary}>
                  Continue
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {stage === 'car' && carStep === 'year' ? (
          <div key="year" className={stepClass}>
            {question(model.length <= 22 ? `What year is your ${model}?` : 'What year is it?')}
            <p className={styles.hint}>The year it was made — it’s on the RC.</p>
            <div className={styles.years} role="group" aria-label="Year made">
              {years.recent.map((y, i) => (
                <button
                  key={y}
                  id={i === 0 ? 'sell-year-first' : undefined}
                  type="button"
                  className={cx(styles.chip, year === y && styles.chosen)}
                  aria-pressed={year === y}
                  onClick={() => chooseYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
            {olderOpen || olderChosen ? (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="sell-older-year">
                    Older than {oldestRecent}
                  </label>
                  <div className={styles.inputWrap}>
                    <select
                      id="sell-older-year"
                      className={cx(styles.input, styles.select)}
                      value={olderChosen ? String(year) : ''}
                      data-autofocus={olderOpen && !olderChosen ? true : undefined}
                      onChange={(e) => {
                        setYear(e.target.value ? Number(e.target.value) : null)
                        clearError('manufacturingYear')
                      }}
                    >
                      <option value="">Choose the year</option>
                      {years.older.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {olderChosen ? (
                  <button type="submit" className={styles.primary}>
                    Continue
                  </button>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  moved.current = true
                  setOlderOpen(true)
                }}
              >
                Older than {oldestRecent}
              </button>
            )}
            {errors.manufacturingYear ? (
              <p className={styles.error} role="alert">
                {errors.manufacturingYear}
              </p>
            ) : null}
          </div>
        ) : null}

        {stage === 'details' ? (
          <div key="details" className={stepClass}>
            <fieldset className={styles.fieldset} style={{ marginTop: 0 }} aria-describedby={errors.evaluationDate ? 'sell-date-error' : undefined}>
              <legend className={styles.srOnly}>When can we see the car?</legend>
              {question('When can we see the car?')}
              <div className={styles.days}>
                {dayOptions.map((ymd, i) => {
                  const label = ymd === today ? 'Today' : ymd === addDays(today, 1) ? 'Tomorrow' : formatDay(ymd).split(',')[0]
                  const chosen = date === ymd
                  return (
                    <button
                      key={ymd}
                      id={i === 0 ? 'sell-day-first' : undefined}
                      type="button"
                      className={cx(styles.chip, styles.dayChip, chosen && styles.chosen)}
                      aria-pressed={chosen}
                      onClick={() => {
                        setDate(ymd)
                        clearError('evaluationDate')
                      }}
                    >
                      <span className={styles.dayName}>{label}</span>
                      <span className={styles.dayDate}>{formatDay(ymd).split(', ')[1] ?? ymd}</span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  className={cx(styles.chip, styles.quiet, date !== '' && !dayOptions.includes(date) && styles.chosen)}
                  aria-pressed={date !== '' && !dayOptions.includes(date)}
                  onClick={() => {
                    moved.current = true
                    setOtherDayOpen(true)
                  }}
                >
                  Another day
                </button>
              </div>
              {otherDayOpen ? (
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="sell-date">
                    Pick a day
                  </label>
                  <div className={styles.inputWrap}>
                    <input
                      id="sell-date"
                      type="date"
                      className={styles.input}
                      data-autofocus
                      min={dayOptions[0] ?? today}
                      max={addDays(today, EVALUATION_WINDOW_DAYS)}
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value)
                        clearError('evaluationDate')
                      }}
                    />
                  </div>
                </div>
              ) : null}
              {errors.evaluationDate ? (
                <p id="sell-date-error" className={styles.error} style={{ marginTop: 8 }}>
                  {errors.evaluationDate}
                </p>
              ) : null}
            </fieldset>

            <fieldset className={styles.fieldset} aria-describedby={errors.interestedInNewCar ? 'sell-newcar-error' : undefined}>
              <legend className={styles.legend}>Also looking at a new car?</legend>
              <div className={styles.segmented}>
                {[
                  { value: true, label: 'Yes', id: 'sell-newcar-yes' },
                  { value: false, label: 'No', id: undefined },
                ].map((option) => (
                  <button
                    key={option.label}
                    id={option.id}
                    type="button"
                    className={cx(styles.chip, newCar === option.value && styles.chosen)}
                    aria-pressed={newCar === option.value}
                    onClick={() => {
                      setNewCar(option.value)
                      clearError('interestedInNewCar')
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {errors.interestedInNewCar ? (
                <p id="sell-newcar-error" className={styles.error} style={{ marginTop: 8 }}>
                  {errors.interestedInNewCar}
                </p>
              ) : null}
            </fieldset>

            <div className={styles.field} style={{ marginTop: 22 }}>
              <label className={styles.legend} style={{ margin: 0 }} htmlFor="sell-km">
                Kilometres driven
              </label>
              <div className={cx(styles.inputWrap, errors.kilometres && styles.inputInvalid)}>
                <input
                  ref={kmRef}
                  id="sell-km"
                  className={styles.input}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 45,000"
                  value={km === '' ? '' : formatKm(Number(km))}
                  onChange={onKmChange}
                  aria-invalid={Boolean(errors.kilometres)}
                  aria-describedby={errors.kilometres ? 'sell-km-error' : 'sell-km-hint'}
                />
                <span className={styles.affix} aria-hidden="true">
                  km
                </span>
              </div>
              {errors.kilometres ? (
                <p id="sell-km-error" className={styles.error}>
                  {errors.kilometres}
                </p>
              ) : (
                <p id="sell-km-hint" className={styles.hint} style={{ margin: 0 }}>
                  The meter reading. Roughly is fine.
                </p>
              )}
            </div>

            <button type="submit" className={styles.primary}>
              Continue
            </button>
          </div>
        ) : null}

        {stage === 'contact' ? (
          <div key="contact" className={stepClass}>
            {question(correcting ? 'What’s the right number?' : 'Who should we call?')}
            <TextField
              id="sell-name"
              label="Your name"
              value={name}
              onChange={(value) => {
                setName(value)
                clearError('customerName')
              }}
              error={errors.customerName}
              autoComplete="name"
              maxLength={80}
            />
            <TextField
              id="sell-mobile"
              label="Mobile number"
              value={phone}
              onChange={(value) => {
                setPhone(value.replace(/[^\d+\s-]/g, '').slice(0, 16))
                clearError('mobile')
              }}
              error={errors.mobile}
              hint="Your number stays with AM Group."
              autoComplete="tel-national"
              inputMode="tel"
              type="tel"
              prefix="+91"
              placeholder="10-digit number"
            />
            <p className={styles.promise}>
              Free. An AM Group evaluator calls you to fix a time and place, and gives you the price after a short look at the car.
            </p>
            {formError ? (
              <p className={styles.formError} role="alert">
                {formError}
              </p>
            ) : null}
            <button type="submit" className={styles.primary} disabled={submitting} aria-busy={submitting}>
              {submitting ? 'Sending…' : 'Get my car’s price'}
            </button>
          </div>
        ) : null}

        {stage === 'done' && sent ? (
          <div key="done" className={stepClass} style={{ marginTop: 0 }}>
            <h2 ref={questionRef} tabIndex={-1} className={styles.question}>
              Thank you, {greetingName(name)}. We have your request.
            </h2>
            <p className={styles.doneCar}>
              {carName}
              <span className={styles.doneKm}>{formatKm(Number(km))} km</span>
            </p>
            <dl className={styles.doneFacts}>
              <div>
                <dt>Day you picked</dt>
                <dd>{date ? formatDay(date, 'long') : ''}</dd>
              </div>
              <div>
                <dt>We’ll call</dt>
                <dd>+91 {spacedMobile(sent.mobile)}</dd>
              </div>
              {sent.id ? (
                <div>
                  <dt>Your reference</dt>
                  <dd>{referenceOf(sent.id)}</dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.doneNote}>
              An AM Group evaluator will call to fix the time and place. You’ll get your price after a short look at the car.
            </p>
            <div className={styles.doneActions}>
              <button type="button" className={styles.linkButton} onClick={fixNumber}>
                Wrong number? Change it
              </button>
              <button type="button" className={styles.linkButton} onClick={startOver}>
                Evaluate another car
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  )
}

function TextField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'tel'
  type?: 'text' | 'tel'
  maxLength?: number
  placeholder?: string
  prefix?: string
  autoFocus?: boolean
}) {
  const errorId = `${props.id}-error`
  const hintId = `${props.id}-hint`
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <div className={cx(styles.inputWrap, props.error && styles.inputInvalid)}>
        {props.prefix ? (
          <span className={styles.affix} aria-hidden="true">
            {props.prefix}
          </span>
        ) : null}
        <input
          id={props.id}
          className={styles.input}
          type={props.type ?? 'text'}
          inputMode={props.inputMode}
          autoComplete={props.autoComplete}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          value={props.value}
          data-autofocus={props.autoFocus ? true : undefined}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={Boolean(props.error)}
          aria-describedby={props.error ? errorId : props.hint ? hintId : undefined}
        />
      </div>
      {props.error ? (
        <p id={errorId} className={styles.error}>
          {props.error}
        </p>
      ) : props.hint ? (
        <p id={hintId} className={styles.hint} style={{ margin: 0 }}>
          {props.hint}
        </p>
      ) : null}
    </div>
  )
}
