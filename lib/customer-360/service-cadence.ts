/**
 * How fast this vehicle is used, and when it is next likely to come in.
 *
 * ── Why this is derived rather than looked up ─────────────────────────────────────────────────
 * Nothing in the feeds states a next-service date. What we DO have is an odometer reading on every
 * service visit (`kia_psf_yearly.mileage` — 3,960 rows, 100% populated and positive, 2,274 VINs),
 * so the distance between two visits and the days between them give a usage rate, and the customer's
 * own gap between SCHEDULED services gives an interval. Those two produce a forecast that is a
 * statement about this customer's history rather than a manufacturer's brochure figure.
 *
 * ⚠️ The previous prediction was a pair of hardcoded calendar thresholds — "last seen > 300 days" —
 * which says the same thing about a car doing 4 km a day and one doing 90. Measured across 954
 * usable vehicles the median is 27.3 km/day, and the spread is what makes the calendar version
 * useless: at the interval below, that is anywhere from a few months to several years.
 *
 * Pure: no database, no clock of its own. `today` is injected so a server/client clock difference
 * cannot change what an employee is told to do, and so this is testable.
 */

/** One service visit, as the reader hands it over. */
export type ServiceReading = {
  /** `kia_psf_yearly.ro_date`. A Postgres DATE, so the driver may hand back a Date OR a string. */
  date: Date | string | null | undefined
  /** `kia_psf_yearly.mileage`. Numeric, but arrives as a string through the driver. */
  km: number | string | null | undefined
  /** `work_type`: 'Free Service' | 'Paid Service' | 'Running Repair' | 'Accidental Repair'. */
  workType?: string | null
  roNo?: string | null
}

export type CleanReading = { date: string; km: number; workType: string | null; scheduled: boolean }

export type ServiceCadence = {
  readings: CleanReading[]
  /** Average km covered per day across the observed span. Null when it cannot be derived honestly. */
  kmPerDay: number | null
  /** Distance this customer actually runs between SCHEDULED services. */
  intervalKm: number | null
  intervalSource: 'own-history' | 'fleet-median' | null
  lastReading: CleanReading | null
  /** Odometer at which the next scheduled service falls due. */
  nextDueKm: number | null
  /** ISO date the vehicle is projected to reach `nextDueKm`. */
  nextDueDate: string | null
  /** Negative once the projected date has passed. */
  daysUntilDue: number | null
  confidence: 'good' | 'low' | 'none'
  /** One sentence naming the evidence, for display. Never empty. */
  basis: string
}

/*
 * The fallback interval, used ONLY when this customer has fewer than two scheduled services of their
 * own. Measured 2026-08-30 over 470 scheduled-service pairs in kia_psf_yearly: p25 6,896 km,
 * median 8,976 km, p75 10,495 km. Rounded to 9,000.
 *
 * ⚠️ It is a fallback, never a default. `intervalSource` always says which was used, and the UI must
 * show it — "9,000 km is what other customers do" is a materially weaker claim than "9,000 km is
 * what THIS customer does", and an employee phoning the customer deserves to know which they hold.
 */
export const FLEET_MEDIAN_SERVICE_INTERVAL_KM = 9000

/**
 * A step implying more than this is treated as a misread odometer, not as driving.
 *
 * Measured 2026-08-30 across 1,624 consecutive steps: p50 28 km/day, p90 78, p95 105, **p99 252**,
 * p99.9 1,081, max 4,064. The tail is not heavy usage — the worst case is 8,903 km to 21,096 km in
 * three days, which no car does. 400 sits above the p99 of genuine commercial use and below that
 * broken cluster, and it discards 13 of 1,624 steps (0.8%).
 *
 * ⚠️ The STEP is dropped, not the vehicle. One bad reading between two good ones would otherwise
 * throw away a whole usable history.
 */
export const MAX_PLAUSIBLE_KM_PER_DAY = 400

/** Only a Free or Paid Service is a scheduled visit; a running or accidental repair is not. */
export function isScheduledService(workType: unknown): boolean {
  return /service/i.test(String(workType ?? ''))
}

/**
 * ⚠️ `ro_date` is a Postgres DATE, so the postgres driver returns a JS **Date**, not a string.
 * `String(value).slice(0, 10)` on a Date yields "Thu Jul 30" — a bug this repo has already shipped
 * once. Both shapes are handled explicitly here.
 */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  const raw = String(value).trim()
  if (!raw) return null
  // Already ISO (possibly with a time component).
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  /*
   * DD/MM/YYYY — day-first, because these are Indian DMS feeds. Month-first would silently move an
   * event by up to a month without ever looking wrong.
   */
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) {
    const [, d, m, y] = dmy
    const mm = Number(m); const dd = Number(d)
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }
  return null
}

const DAY_MS = 86_400_000

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS)
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/**
 * Order the readings and remove the ones that cannot be reasoned about.
 *
 * ⚠️ SAME-DAY VISITS ARE COLLAPSED. A car can be booked in twice on one day — measured, one vehicle
 * has 39,328 km and 39,326 km both on 2026-04-22. Ordered by date alone that is a **-2 km** step,
 * and any rate derived across it is nonsense (or a divide-by-zero on the day gap). The highest
 * reading for a day wins, because an odometer only goes up within a day.
 *
 * ⚠️ NON-INCREASING PAIRS ARE DROPPED, not clamped. 26 of 1,686 consecutive pairs decrease — a
 * replaced cluster, a re-used registration, or a typo. Clamping to zero would quietly drag the
 * average rate down; dropping says "we cannot read this step" and leaves the rest intact.
 */
export function cleanReadings(rows: readonly ServiceReading[]): CleanReading[] {
  const byDate = new Map<string, CleanReading>()
  for (const r of rows) {
    const date = toIsoDate(r.date)
    const km = Number(r.km)
    if (!date || !Number.isFinite(km) || km <= 0) continue
    const existing = byDate.get(date)
    const scheduled = isScheduledService(r.workType)
    if (!existing || km > existing.km) {
      byDate.set(date, {
        date,
        km,
        workType: r.workType ?? null,
        // A day that held any scheduled service counts as scheduled, whichever reading won.
        scheduled: scheduled || existing?.scheduled || false,
      })
    } else if (scheduled && existing) {
      existing.scheduled = true
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Consecutive steps that genuinely move forwards in both time and distance. */
function forwardSteps(readings: readonly CleanReading[]) {
  const steps: { km: number; days: number; toScheduled: boolean; fromScheduled: boolean }[] = []
  for (let i = 1; i < readings.length; i += 1) {
    const a = readings[i - 1]; const b = readings[i]
    const km = b.km - a.km
    const days = daysBetween(a.date, b.date)
    // A misread odometer is not driving — see MAX_PLAUSIBLE_KM_PER_DAY.
    if (km > 0 && days > 0 && km / days <= MAX_PLAUSIBLE_KM_PER_DAY) {
      steps.push({ km, days, toScheduled: b.scheduled, fromScheduled: a.scheduled })
    }
  }
  return steps
}

/**
 * Build the cadence for one vehicle.
 *
 * `today` is required and injected — see the module note.
 */
export function buildServiceCadence(
  rows: readonly ServiceReading[],
  today: Date,
): ServiceCadence {
  const readings = cleanReadings(rows)
  const last = readings.length ? readings[readings.length - 1] : null
  const empty: ServiceCadence = {
    readings,
    kmPerDay: null,
    intervalKm: null,
    intervalSource: null,
    lastReading: last,
    nextDueKm: null,
    nextDueDate: null,
    daysUntilDue: null,
    confidence: 'none',
    basis: readings.length === 1
      ? 'One odometer reading on file — a second visit is needed before usage can be estimated.'
      : 'No odometer readings on file for this vehicle.',
  }
  if (readings.length < 2 || !last) return empty

  const steps = forwardSteps(readings)
  if (!steps.length) return { ...empty, basis: 'Odometer readings on file do not increase, so usage cannot be estimated.' }

  /*
   * Rate over the whole observed SPAN rather than an average of per-step rates: a short step between
   * two visits a week apart would otherwise carry the same weight as a year of driving.
   */
  const totalKm = steps.reduce((a, s) => a + s.km, 0)
  const totalDays = steps.reduce((a, s) => a + s.days, 0)
  const kmPerDay = totalDays > 0 ? totalKm / totalDays : null

  /*
   * The interval this customer actually keeps — measured across the SCHEDULED SUBSEQUENCE, not
   * across consecutive readings.
   *
   * ⚠️ This distinction is the whole value of the feature. Cars come in for running and accidental
   * repairs between their scheduled services, so consecutive pairs almost never have a scheduled
   * visit at both ends: measured, that approach found an own-interval for 23 vehicles, while 409
   * genuinely have two or more scheduled services on file. Reading the scheduled visits as their own
   * series — ignoring whatever repairs happened in between — recovers the other 386.
   */
  const scheduled = readings.filter((r) => r.scheduled)
  const ownGaps: number[] = []
  for (let i = 1; i < scheduled.length; i += 1) {
    const km = scheduled[i].km - scheduled[i - 1].km
    const days = daysBetween(scheduled[i - 1].date, scheduled[i].date)
    if (km > 0 && days > 0 && km / days <= MAX_PLAUSIBLE_KM_PER_DAY) ownGaps.push(km)
  }
  /*
   * ONE observed gap is enough to prefer it over the fleet median: a single interval this customer
   * actually kept is a fact about them, where the fleet figure is a fact about strangers. Confidence
   * carries the difference instead.
   */
  const ownInterval = ownGaps.length >= 1 ? median(ownGaps) : null
  const intervalKm = ownInterval ?? FLEET_MEDIAN_SERVICE_INTERVAL_KM
  const intervalSource: ServiceCadence['intervalSource'] = ownInterval ? 'own-history' : 'fleet-median'

  // Due from the last SCHEDULED service if there is one; a repair visit does not reset the clock.
  const lastScheduled = [...readings].reverse().find((r) => r.scheduled) ?? null
  const base = lastScheduled ?? last
  const nextDueKm = base.km + intervalKm

  let nextDueDate: string | null = null
  let daysUntilDue: number | null = null
  if (kmPerDay && kmPerDay > 0) {
    const kmRemaining = nextDueKm - last.km
    const daysFromLastReading = Math.round(kmRemaining / kmPerDay)
    nextDueDate = addDays(last.date, daysFromLastReading)
    daysUntilDue = daysBetween(toIsoDate(today)!, nextDueDate)
  }

  // 'good' needs a REPEATED interval of their own, not a single observation.
  const confidence: ServiceCadence['confidence'] = ownGaps.length >= 2 && readings.length >= 3 ? 'good' : 'low'
  const rateText = kmPerDay ? `${Math.round(kmPerDay).toLocaleString('en-IN')} km/day` : 'an unknown rate'
  const basis = ownInterval
    ? `${readings.length} readings — this customer averages ${rateText} and services every ${intervalKm.toLocaleString('en-IN')} km.`
    : `${readings.length} readings — this customer averages ${rateText}. Interval assumed at ${intervalKm.toLocaleString('en-IN')} km (the median across all KIA customers), because they have fewer than two scheduled services on file.`

  return {
    readings,
    kmPerDay,
    intervalKm,
    intervalSource,
    lastReading: last,
    nextDueKm,
    nextDueDate,
    daysUntilDue,
    confidence,
    basis,
  }
}
