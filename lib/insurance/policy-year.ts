/**
 * The customer's WHOLE insurance history with us, rendered on every policy row.
 *
 * ── What this is ──────────────────────────────────────────────────────────────────────────────
 * The register used to show the feed's own NEW / RENEWAL / ROLLOVER, so a renewal read the same
 * whether it was the customer's second year or their fifth. Showing this row's position alone was
 * not enough either — the point is to see the shape of the relationship at a glance:
 *
 *     Y1 · Y2 · Rollover · Y3 · Y4
 *
 * Every row of that vehicle shows the same chain, with the row you are looking at emphasised.
 *
 * ── The numbering rule ────────────────────────────────────────────────────────────────────────
 * ⚠️ THE NUMBER IS THE VEHICLE'S YEAR, NOT OUR ROW COUNT.
 *
 *     Y = cover start year − manufacture year + 1
 *
 * Counting the policies we hold produced numbers that contradicted the date beside them: a 2021
 * Santro's 2026-27 policy read "Y4" because we hold four of its policies, when 2026 is plainly that
 * car's SIXTH year. Anchoring on manufacture makes the chain start where the car does — that Santro
 * now reads Y3 · Y4 · Y5 · Y6, which also shows at a glance that its first two years are missing
 * from our book. mfg_year is populated on 100% of Hyundai and Platinum rows.
 *
 * A ROLLOVER is an EVENT: it shows as 'Rollover' rather than a number, in its place in the timeline.
 *
 * ⚠️ We can only count what we hold. Measured on Hyundai — 26,498 policies over 12,862 vehicles —
 * the earliest policy on file is already a RENEWAL for 14,580 of them: those customers were insured
 * before our data begins and we cannot know for how long. Their chain is prefixed with a leading
 * ellipsis so nobody reads Y1 as "first year". Anchored chains (we hold the NEW, or the ROLLOVER
 * that started the relationship) carry no ellipsis and the numbers are literal.
 */

export type PolicyChainEntry = {
  /** 'Y1', 'Y2', 'Rollover' … */
  label: string
  kind: 'year' | 'rollover'
  /** True for the policy whose row this is. */
  current: boolean
  /**
   * The cover year this entry stands for, e.g. '2026-27'.
   *
   * ⚠️ Carried because the number alone is genuinely ambiguous on screen: "Y4" beside a policy
   * ISSUED in 2026 reads as a contradiction until you can see that Y4 IS the 2026-27 cover year.
   * The number counts the customer's years with us; it says nothing about how long any one policy
   * runs (they are 1-year policies).
   */
  period: string | null
}

export type PolicyChain = {
  entries: PolicyChainEntry[]
  /** Our records begin mid-relationship — render a leading ellipsis. */
  truncated: boolean
  /** Long form for the cell's title attribute. */
  title: string
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
const isRollover = (t: unknown) => norm(t) === 'ROLLOVER'
const isNew = (t: unknown) => norm(t) === 'NEW'

/**
 * @param types        every policy type for this vehicle, in date order, oldest first
 * @param currentIndex 1-based position of the row being rendered within `types`
 */
/** The calendar year a cover period starts in, or null. */
function startYearOf(value: unknown): number | null {
  const d = value ? new Date(String(value)) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.getFullYear()
}

/** '2026-27' from a cover start date; null when we have no usable date. */
function coverYear(value: unknown): string | null {
  const d = value ? new Date(String(value)) : null
  if (!d || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

export function policyYearChain(
  types: unknown[],
  currentIndex: number | null | undefined,
  starts: unknown[] = [],
  mfgYear?: unknown,
): PolicyChain {
  const list = Array.isArray(types) ? types : []
  const dates = Array.isArray(starts) ? starts : []
  const idx = Number(currentIndex)
  const mfg = Number(String(mfgYear ?? '').replace(/[^0-9]/g, ''))
  const hasMfg = Number.isFinite(mfg) && mfg > 1900 && mfg < 2200

  if (!list.length) {
    return { entries: [], truncated: false, title: 'No policy history on file for this vehicle' }
  }

  /*
   * Anchored when we hold the policy that STARTED the relationship — a NEW, or a ROLLOVER onto our
   * book. Anything else means the history begins before our records do.
   */
  /*
   * Truncated = our book does not begin at the vehicle's first year. With age-anchored numbers this
   * is simply "the chain does not start at Y1", which is both stricter and more honest than the old
   * test (whether the first row happened to be typed NEW).
   */
  const firstStart = startYearOf(dates[0])
  const truncated = hasMfg && firstStart
    ? firstStart - mfg + 1 > 1
    : !(isNew(list[0]) || isRollover(list[0]))

  let fallbackYear = 0
  const entries: PolicyChainEntry[] = list.map((t, i) => {
    const current = i + 1 === idx
    const period = coverYear(dates[i])
    if (isRollover(t)) {
      return { label: 'Rollover', kind: 'rollover' as const, current, period }
    }
    fallbackYear += 1

    /*
     * Vehicle age where we can compute it. The fallback — position among the rows we hold — is only
     * for a missing or nonsensical manufacture year (a cover date before the car was built), and it
     * is exactly the numbering that caused the confusion, so it must never be the normal path.
     */
    const startYear = startYearOf(dates[i])
    const ageYear = hasMfg && startYear ? startYear - mfg + 1 : 0
    const label = ageYear > 0 ? `Y${ageYear}` : `Y${fallbackYear}`
    return { label, kind: 'year' as const, current, period }
  })

  // Spell out the period beside each number, so the tooltip cannot be misread the way the bare
  // chips were: "Y1 2023-24 · Y2 2024-25 · …".
  const shape = entries.map((e) => (e.period ? `${e.label} ${e.period}` : e.label)).join(' · ')
  const title = truncated
    ? `${shape} — numbered by the vehicle's age; the earlier years are not on our book`
    : `${shape} — the vehicle's full insurance history with us`

  return { entries, truncated, title }
}
