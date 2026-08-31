/**
 * The insurance relationship, derived from a vehicle's policy chain.
 *
 * ── WHY THE SPINE IS THE VEHICLE, NOT THE CUSTOMER ────────────────────────────────────────────
 * The brief asks for a customer-first module. The data does not support one for 96% of the book, and
 * this was measured rather than assumed:
 *
 *   - There is NO phone on any insurance feed. `mob_no` exists on the Hyundai and Platinum tables
 *     and is EMPTY on all 39,989 rows.
 *   - Customer NAME is not a party key. Normalised, "RAKESH KUMAR" spans 81 distinct chassis,
 *     "ASHOK KUMAR" 74, "VIJAY KUMAR" 58. Keying a profile on name would merge dozens of strangers
 *     into one history — the same class of defect that once merged 2,411 Customer 360 profiles and
 *     showed one person another's records.
 *   - The bridge to the sales feed is BROKEN for Hyundai and Platinum: their `vin_number` is masked
 *     at source on 100% of rows (`**********06530`), so joining insurance chassis to sales VIN
 *     returns exactly 0 matches on both.
 *   - Matching on the 5 visible mask digits was tested and REJECTED: of 6,432 suffix matches, 1,083
 *     are ambiguous — 16.8% would attach a policy to the wrong person.
 *
 * KIA is the one exception: `kia_insurance.vinno` -> `kia_sales_report.vin_no` -> `customerid`
 * resolves a real DMS party key on 764 of 1,217 insured vehicles (63%), reaching 731 customers. The
 * customer layer is built ONLY on that, and every other vehicle is presented as a vehicle
 * relationship rather than being given an invented owner.
 *
 * Pure: no database, and `today` is injected so a server/client clock difference cannot change what
 * an employee is told, and so every rule here is testable.
 */

/**
 * The gap, in days, beyond which cover is no longer continuous.
 *
 * ── Measured, not chosen ──────────────────────────────────────────────────────────────────────
 * Across 13,480 consecutive own-damage policy pairs on the Hyundai feed, the gap between one policy
 * expiring and the next starting is:
 *
 *     <= 0 days (overlap)        0
 *     1-30 days             12,958   (96.1%)   <- median 1, p90 1
 *     31-90 days               134
 *     91-365 days               98
 *     > 365 days               290
 *
 * The mass sits at exactly ONE day — the next policy starts the day after the last one ends. After
 * 30 days there is a clear valley, so 30 is the edge of that cluster rather than a round number
 * somebody liked. A customer inside it never lost cover; beyond it they did.
 *
 * ⚠️ Changing this reclassifies thousands of customers between RETAINED and LAPSED. It is a business
 * rule, not a tuning knob — move it only with the distribution above re-measured.
 */
export const CONTINUOUS_COVER_WINDOW_DAYS = 30

/** How far ahead we call a policy "due for renewal". */
export const RENEWAL_DUE_WINDOW_DAYS = 60

/**
 * Beyond this, a lapsed customer is treated as LOST rather than merely lapsed.
 *
 * ⚠️ Not reachable on the KIA feed. Its earliest policy expiry is 2026-01-08, so the maximum
 * achievable lapse is short of a year and `LOST` is measured as 0 there. The UI must not offer a
 * filter that can only ever return nothing — see `hasLostCoverBucket` in lib/insurance/brands.ts.
 */
export const LOST_AFTER_DAYS = 365

/** The feed's own classification of a policy. Present on all three brands. */
export type PolicyEventType = 'NEW' | 'RENEWAL' | 'ROLLOVER' | 'UNKNOWN'

/** One policy, as the reader hands it over. Dates are ISO or a Postgres DATE. */
export type PolicyInput = {
  policyNo: string | null
  /** `policy_start_date`. */
  startDate: Date | string | null | undefined
  /**
   * The OWN-DAMAGE expiry. Hyundai and Platinum use `od_expiry_date`; KIA uses
   * `policy_expiry_date`.
   *
   * ⚠️ Hyundai's `policy_expiry_date` column exists and is NULL on all 26,436 rows. Reading it
   * instead of `od_expiry_date` yields a whole feed with no expiries and an empty renewal pipeline.
   */
  expiryDate: Date | string | null | undefined
  issueDate?: Date | string | null | undefined
  /** Verbatim from the feed — 'NEW' | 'RENEWAL' | 'ROLLOVER', or KIA's Title Case 'New' | 'Renewal'. */
  policyType: string | null | undefined
  insurer?: string | null
  grossPremium?: number | string | null
  /**
   * Whether this row is an own-damage policy. A renewal EVENT is an OD policy, not a row: every car
   * carries an OD policy plus a fixed-premium third-party companion, so counting rows roughly
   * doubles every figure. Resolved by the caller via `isOdExpr` in lib/insurance/brands.ts, which
   * knows each brand's discriminator.
   */
  isOwnDamage: boolean
  cancelled?: boolean
}

export type JourneyStop = {
  sequence: number
  policyNo: string | null
  startDate: string | null
  expiryDate: string | null
  eventType: PolicyEventType
  insurer: string | null
  grossPremium: number | null
  /** Days between the previous policy's expiry and this one's start. Null on the first stop. */
  gapDays: number | null
  /** True when `gapDays` exceeds the continuous-cover window — cover was actually lost. */
  brokeCover: boolean
  active: boolean
}

export type CoverStatus =
  | 'ACTIVE'
  | 'DUE_FOR_RENEWAL'
  | 'EXPIRED'
  | 'LAPSED'
  | 'LOST'
  | 'NO_COVER_ON_RECORD'

export type InsuranceRelationship = {
  journey: JourneyStop[]
  /** OD policies only — the count of real renewal-bearing policies. */
  policyCount: number
  /** Every row, including third-party companions. Shown only where the distinction is explained. */
  rowCount: number
  firstPolicyDate: string | null
  latestPolicyDate: string | null
  latestExpiryDate: string | null
  status: CoverStatus
  daysToExpiry: number | null
  renewalCount: number
  rolloverCount: number
  /** True when cover has never broken across the whole observed chain AND there is more than one policy. */
  neverLapsed: boolean
  /** The longest break in cover, in days. Null when there is only one policy. */
  longestGapDays: number | null
  /** Consecutive years of unbroken cover, from the first policy to the latest expiry. */
  yearsRetained: number | null
  /**
   * ⚠️ TRUE when the earliest policy we hold is a RENEWAL or ROLLOVER — the customer's relationship
   * began before our data does, so "first policy" is the start of our WINDOW, not of the
   * relationship. Measured on Hyundai: 5,737 of 18,962 renewal policies are first-in-window.
   * Counting those as new customers would overstate acquisition by that whole amount.
   */
  leftCensored: boolean
  /** Set when the chain cannot be trusted — see the brief's "Match needs review". */
  reviewReasons: string[]
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ A Postgres DATE arrives from this driver as a JS **Date**, not a string, and
 * `String(value).slice(0, 10)` on one yields "Thu Jul 30". That bug has shipped here before.
 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const raw = String(value).trim()
  if (!raw) return null
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // Day-first: these are Indian DMS feeds, and month-first would move a policy by up to a month.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) {
    const d = Number(dmy[1]); const m = Number(dmy[2])
    if (d < 1 || d > 31 || m < 1 || m > 12) return null
    return `${dmy[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

const DAY = 86_400_000
const days = (fromIso: string, toIsoStr: string) =>
  Math.round((Date.parse(`${toIsoStr}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY)

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The feed's own word, normalised.
 *
 * ⚠️ Read from the feed rather than derived from gaps, and the two were checked against each other:
 * of 5,146 Hyundai policies typed NEW, 5,146 are the first on their chassis — the feed is internally
 * consistent, so re-deriving would only add a second, disagreeing answer.
 *
 * ⚠️ KIA stores Title Case ('New', 'Renewal') and has NO rollover value at all. An uppercase literal
 * comparison scores a silent zero there; this normalises before matching.
 */
export function classifyPolicyType(value: unknown): PolicyEventType {
  const v = String(value ?? '').trim().toUpperCase()
  if (v === 'NEW') return 'NEW'
  if (v === 'RENEWAL') return 'RENEWAL'
  if (v === 'ROLLOVER') return 'ROLLOVER'
  return 'UNKNOWN'
}

/* -------------------------------------------------------------------------- */
/* The relationship                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build one vehicle's insurance relationship from its policies.
 *
 * `rows` may arrive in any order and may include third-party companion rows; both are handled here
 * so no caller has to remember to.
 */
export function buildRelationship(rows: readonly PolicyInput[], today: Date): InsuranceRelationship {
  const todayIso = toIso(today)!
  const reviewReasons: string[] = []

  /*
   * OD policies only. The third-party companion is not a renewal event, and including it would
   * roughly double every count and invent a "gap" of zero days between a policy and its own twin.
   */
  const od = rows
    .filter((r) => r.isOwnDamage && !r.cancelled)
    .map((r) => ({
      ...r,
      start: toIso(r.startDate),
      expiry: toIso(r.expiryDate),
    }))
    .filter((r) => r.start || r.expiry)

  if (!od.length) {
    return {
      journey: [], policyCount: 0, rowCount: rows.length,
      firstPolicyDate: null, latestPolicyDate: null, latestExpiryDate: null,
      status: 'NO_COVER_ON_RECORD', daysToExpiry: null,
      renewalCount: 0, rolloverCount: 0, neverLapsed: false, longestGapDays: null,
      yearsRetained: null, leftCensored: false,
      reviewReasons: rows.length ? ['Policies on file carry no own-damage cover or usable dates.'] : [],
    }
  }

  // Ordered by start, then expiry — a same-day pair must still resolve to a stable order.
  od.sort((a, b) => String(a.start ?? a.expiry).localeCompare(String(b.start ?? b.expiry))
    || String(a.expiry ?? '').localeCompare(String(b.expiry ?? '')))

  const journey: JourneyStop[] = []
  let previousExpiry: string | null = null
  let longestGap: number | null = null
  let broke = false

  od.forEach((r, index) => {
    const gapDays = previousExpiry && r.start ? days(previousExpiry, r.start) : null
    /*
     * ⚠️ A NEGATIVE gap is an overlap, not a break. Two policies covering the same window is a data
     * problem worth flagging, but it is emphatically not a lapse — treating it as one would mark the
     * most continuously-covered customers as having broken cover.
     */
    if (gapDays !== null && gapDays < 0) {
      reviewReasons.push(`Policies overlap by ${Math.abs(gapDays)} days around ${r.start}.`)
    }
    const brokeCover = gapDays !== null && gapDays > CONTINUOUS_COVER_WINDOW_DAYS
    if (brokeCover) broke = true
    if (gapDays !== null && gapDays > 0) longestGap = Math.max(longestGap ?? 0, gapDays)

    journey.push({
      sequence: index + 1,
      policyNo: r.policyNo ?? null,
      startDate: r.start,
      expiryDate: r.expiry,
      eventType: classifyPolicyType(r.policyType),
      insurer: r.insurer ?? null,
      grossPremium: r.grossPremium == null || r.grossPremium === '' ? null : Number(r.grossPremium),
      gapDays,
      brokeCover,
      active: Boolean(r.expiry && r.expiry >= todayIso && r.start && r.start <= todayIso),
    })
    if (r.expiry && (!previousExpiry || r.expiry > previousExpiry)) previousExpiry = r.expiry
  })

  const latestExpiry = journey.reduce<string | null>(
    (acc, s) => (s.expiryDate && (!acc || s.expiryDate > acc) ? s.expiryDate : acc), null)
  const daysToExpiry = latestExpiry ? days(todayIso, latestExpiry) : null

  let status: CoverStatus = 'NO_COVER_ON_RECORD'
  if (daysToExpiry !== null) {
    if (daysToExpiry < -LOST_AFTER_DAYS) status = 'LOST'
    else if (daysToExpiry < -CONTINUOUS_COVER_WINDOW_DAYS) status = 'LAPSED'
    else if (daysToExpiry < 0) status = 'EXPIRED'
    else if (daysToExpiry <= RENEWAL_DUE_WINDOW_DAYS) status = 'DUE_FOR_RENEWAL'
    else status = 'ACTIVE'
  }

  const first = journey[0]
  /*
   * The relationship predates our data whenever the EARLIEST policy we hold is already a renewal or
   * a rollover. "Customer since" is then the start of our window, not of the relationship.
   */
  const leftCensored = first.eventType === 'RENEWAL' || first.eventType === 'ROLLOVER'
  if (leftCensored) {
    reviewReasons.push('Earliest policy on file is already a renewal or rollover — the relationship began before our records.')
  }

  const firstStart = journey.find((s) => s.startDate)?.startDate ?? null
  const yearsRetained = firstStart && latestExpiry
    ? Math.max(0, Math.round((days(firstStart, latestExpiry) / 365.25) * 10) / 10)
    : null

  return {
    journey,
    policyCount: journey.length,
    rowCount: rows.length,
    firstPolicyDate: firstStart,
    latestPolicyDate: journey[journey.length - 1]?.startDate ?? null,
    latestExpiryDate: latestExpiry,
    status,
    daysToExpiry,
    renewalCount: journey.filter((s) => s.eventType === 'RENEWAL').length,
    rolloverCount: journey.filter((s) => s.eventType === 'ROLLOVER').length,
    // One policy is not a retention record — there has been no opportunity to lapse yet.
    neverLapsed: journey.length > 1 && !broke,
    longestGapDays: longestGap,
    yearsRetained,
    leftCensored,
    reviewReasons,
  }
}

/* -------------------------------------------------------------------------- */
/* Segments                                                                   */
/* -------------------------------------------------------------------------- */

export const INSURANCE_SEGMENTS = [
  'NEW', 'RENEWAL', 'ROLLOVER', 'RETAINED', 'NEVER_LAPSED',
  'LAPSED', 'LOST', 'DUE_FOR_RENEWAL', 'EXPIRED', 'MULTI_POLICY',
] as const
export type InsuranceSegment = (typeof INSURANCE_SEGMENTS)[number]

/**
 * Which segments a relationship belongs to. A relationship can sit in several at once — RETAINED and
 * DUE_FOR_RENEWAL are not mutually exclusive, and forcing a single label would hide the one an
 * employee needs to act on.
 */
export function segmentsFor(rel: InsuranceRelationship): InsuranceSegment[] {
  const out: InsuranceSegment[] = []
  if (rel.policyCount === 0) return out

  const firstType = rel.journey[0]?.eventType
  if (firstType === 'NEW') out.push('NEW')
  if (rel.renewalCount > 0) out.push('RENEWAL')
  if (rel.rolloverCount > 0) out.push('ROLLOVER')
  if (rel.policyCount > 1) out.push('MULTI_POLICY')
  if (rel.neverLapsed) out.push('NEVER_LAPSED')
  // RETAINED is the weaker claim: more than one policy and cover intact TODAY.
  if (rel.policyCount > 1 && (rel.status === 'ACTIVE' || rel.status === 'DUE_FOR_RENEWAL')) out.push('RETAINED')
  if (rel.status === 'DUE_FOR_RENEWAL') out.push('DUE_FOR_RENEWAL')
  if (rel.status === 'EXPIRED') out.push('EXPIRED')
  if (rel.status === 'LAPSED') out.push('LAPSED')
  if (rel.status === 'LOST') out.push('LOST')
  return out
}

/** Human wording for a status, used in tables and on the profile. */
export const COVER_STATUS_LABEL: Record<CoverStatus, string> = {
  ACTIVE: 'Active',
  DUE_FOR_RENEWAL: 'Due for renewal',
  EXPIRED: 'Expired',
  LAPSED: 'Lapsed',
  LOST: 'Lost',
  // Never "Uninsured": the feed only covers policies sold through the dealership, so a customer
  // insured elsewhere is indistinguishable from one with no cover.
  NO_COVER_ON_RECORD: 'No policy with us',
}
