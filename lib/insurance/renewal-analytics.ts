import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  INSURANCE_BRANDS,
  activeRowsPredicate,
  col,
  insuranceSource,
  isOdExpr,
  type InsuranceBrandId,
} from '@/lib/insurance/brands'

/**
 * The analytics half of the renewal story: how we are TRENDING and how many customers we KEEP.
 *
 * lib/insurance/renewals.ts answers "who do we call this week" — a work queue. This answers the
 * questions asked of it a level up: is the book growing, and do customers come back.
 *
 * ⚠️ Built on exactly the same primitives as the queue — `insuranceSource()`, `isOdExpr()`,
 * `activeRowsPredicate()`. That is deliberate: if the queue counts a renewal one way and this counts
 * it another, a card and the list under it disagree and neither gets trusted again.
 *
 * The two rules that make these numbers mean anything:
 *   1. A RENEWAL EVENT IS AN OWN-DAMAGE POLICY, NOT A ROW. Every car carries an OD policy plus a
 *      fixed-premium third-party companion, and one pair per year — a 4-year-old vehicle holds ~7
 *      rows for 4 renewals. Counting rows would roughly double every figure here.
 *   2. THE VEHICLE IS THE CHASSIS. Registration is unusable in the KIA feed (44 of 1,438 rows
 *      carry one); chassis is present on effectively all of them.
 */

export type RenewalYoyPoint = {
  year: number
  policies: number
  premium: number
  /** True when the year is still running, or the feed only partly covers it. */
  partial: boolean
  /**
   * Same slice of the PREVIOUS year — Jan 1 to today's month/day. Present only on a partial year,
   * so the growth shown against it is like-for-like rather than a full year against a stub.
   */
  priorYearToSameDate?: { policies: number; premium: number }
}

export type RetentionCohort = {
  /** Month whose policies expired, 'YYYY-MM'. */
  month: string
  expired: number
  /** Expired vehicles that took another own-damage policy with us. */
  retained: number
  lapsed: number
  retentionPct: number | null
  premiumRetained: number
  premiumLost: number
}

export type InsurerShare = {
  insurer: string
  policies: number
  premium: number
  sharePct: number
}

/**
 * What happened to each own-damage policy, per vehicle, in sequence.
 *
 * ── The classification, and why each case is separate ─────────────────────────────────────────
 *   NEW       the vehicle's FIRST policy with us — a customer we did not have before
 *   RENEWED   the next policy began within 30 days of the last one expiring — continuous cover
 *   WON BACK  the next policy began MORE than 30 days after expiry — they left, then returned.
 *             Collapsing this into RENEWED hides the single most flattering number the book has,
 *             and collapsing it into NEW double-counts a customer we already had.
 *   LOST      the policy expired, nothing followed, and enough time has passed to judge
 */
export type CustomerMovementPoint = {
  /** 'YYYY-MM'. New/renewed/won-back are keyed on policy START; lost on the EXPIRY that ended it. */
  month: string
  newCustomers: number
  renewed: number
  wonBack: number
  lost: number
  /** newCustomers + wonBack - lost. Only meaningful once lossesFinal is true. */
  net: number
  /**
   * False while the month is still inside the grace window, i.e. its losses cannot be judged yet.
   *
   * WARNING: without this the newest months always look like growth. August 2026 reported +171 net
   * with lost = 0, purely because a policy that expired three weeks ago has not yet run out of time
   * to renew. The UI must not draw those months as if the loss column were complete.
   */
  lossesFinal: boolean
  premiumNew: number
  premiumLost: number
}

export type LeakPoint = {
  key: string
  expired: number
  lost: number
  lapsePct: number | null
  premiumLost: number
}

/**
 * Retention split by a property of the policy that EXPIRED — answers "which kind of customer do we
 * lose", rather than just how many.
 */
export type SegmentRetention = {
  key: string
  /** Stable display order; the natural sort of these labels is wrong ("2" before "10", "45" before "5"). */
  order: number
  expired: number
  retained: number
  retentionPct: number | null
  premiumLost: number
}

export type RenewalTimingBucket = {
  bucket: 'early' | 'on_time' | 'late' | 'recovered' | 'won_back'
  label: string
  policies: number
}

export type UrgencyBucket = {
  bucket: 'overdue' | 'week' | 'month' | 'quarter'
  label: string
  vehicles: number
  premium: number
}

export type RenewalAnalytics = {
  generatedAt: string
  asOf: string
  brands: InsuranceBrandId[]
  yoy: RenewalYoyPoint[]
  /** Overall retention across every cohort old enough to judge. */
  retention: {
    expired: number
    retained: number
    lapsed: number
    retentionPct: number | null
    premiumRetained: number
    premiumLost: number
  }
  cohorts: RetentionCohort[]
  insurers: InsurerShare[]
  /** Vehicles whose OD policy expires in each of the next 12 months. */
  forwardBook: { month: string; vehicles: number; premium: number }[]
  /** Customers gained, kept, recovered and lost, month by month. */
  movement: CustomerMovementPoint[]
  /** Where cover leaks: the models and branches losing the most vehicles. */
  leaks: { byModel: LeakPoint[]; byBranch: LeakPoint[] }
  /** When renewals actually happen relative to expiry — tells the calling team when to start. */
  timing: RenewalTimingBucket[]
  /** How urgent the forward book is right now. */
  urgency: UrgencyBucket[]
  /**
   * Who we lose, by no-claim-bonus slab and by what they were paying.
   *
   * ⚠️ NCB is only recorded on the Hyundai and Platinum feeds (25,993/25,994 and 13,475/13,475);
   * KIA carries it on 72 of 1,438 rows. The "Not recorded" bucket is therefore mostly KIA and is
   * kept visible rather than dropped, so the slabs are never read as covering the whole book.
   */
  segments: { byNcb: SegmentRetention[]; byPremiumBand: SegmentRetention[] }
}

type Row = Record<string, unknown>
const rowsOf = (result: unknown): Row[] => (Array.isArray(result) ? result as Row[] : [])
const num = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * One vehicle's own-damage policies, one row per policy, across the selected brands.
 *
 * ⚠️ NOT deduped to the latest policy — unlike the work queue, the HISTORY is the point here.
 * A vehicle with three OD policies contributes three rows, which is what makes "did they come
 * back after this one expired" answerable at all.
 */
function odPolicyUnionSql(brands: InsuranceBrandId[]) {
  const parts = brands.map((brandId) => {
    const brand = INSURANCE_BRANDS[brandId]
    const c = (key: Parameters<typeof col>[1]) => sql.raw(col(brandId, key))
    return sql`
      SELECT
        ${brandId}::text                              AS brand,
        UPPER(BTRIM(t.${c('chassisNo')}::text))       AS chassis_no,
        t.${c('odExpiryDate')}::date                  AS expiry_date,
        t.${c('policyStartDate')}::date               AS start_date,
        NULLIF(BTRIM(t.${c('grossPremium')}::text), '')::numeric AS premium,
        NULLIF(BTRIM(t.${c('insuranceCompany')}::text), '')      AS insurer,
        NULLIF(BTRIM(t.${c('modelName')}::text), '')             AS model_name,
        NULLIF(BTRIM(t.${c('dealerCode')}::text), '')            AS dealer_code,
        /*
         * Left as TEXT and NULL when blank, deliberately. A "0" slab is a real answer (the customer
         * claimed, or it is their first year); a blank means the feed never recorded one. Casting
         * blanks to 0 would merge "claimed last year" with "unknown" and corrupt both.
         *
         * ⚠️ NOT every brand maps this column — col() THROWS rather than guessing, which is the
         * right behaviour but means the capability has to be checked here. KIA has no NCB column in
         * the map, so its rows contribute NULL and land in "Not recorded" rather than being
         * silently attributed to a slab they were never assigned.
         */
        ${INSURANCE_BRANDS[brandId].columns.currentNcbPercentage
          ? sql`NULLIF(BTRIM(t.${c('currentNcbPercentage')}::text), '')`
          : sql`NULL::text`}                                     AS ncb_slab
      -- insuranceSource() EMITS THE ALIAS ITSELF and, for the Hyundai/Platinum feeds, wraps the
      -- table in a DISTINCT ON (policy_no) dedup — those feeds append a new row per re-upload, so
      -- the raw table holds snapshot versions of the same policy. Appending our own alias here is
      -- a syntax error, and reading the raw table would multiply every figure by the upload count.
      FROM ${sql.raw(insuranceSource(brandId, 't'))}
      -- sql.raw: these helpers return SQL TEXT, not fragments. Interpolated plainly they bind as
      -- PARAMETERS ($6, $8) and Postgres evaluates the whole WHERE as a bare boolean parameter.
      WHERE ${sql.raw(activeRowsPredicate(brandId, 't'))}
        AND ${sql.raw(isOdExpr(brandId, 't'))}
        AND COALESCE(BTRIM(t.${c('chassisNo')}::text), '') <> ''
    `
    void brand
  })
  return parts.reduce((acc, part, index) => (index === 0 ? part : sql`${acc} UNION ALL ${part}`))
}

/**
 * Policies written and premium earned per calendar year — the growth line.
 *
 * Keyed on the policy START date, not expiry: a policy written in March 2026 is 2026 business even
 * though it expires in 2027. Bucketing by expiry would report the same book a year late.
 */
async function fetchYoy(brands: InsuranceBrandId[], asOf: string): Promise<RenewalYoyPoint[]> {
  /*
   * ⚠️ TWO WAYS THIS LINE LIES IF WRITTEN NAIVELY, both seen on real data here:
   *
   * 1. THE CURRENT YEAR IS PARTIAL. On 25 August, 2026 holds ~8 months of policies against 2025's
   *    twelve — a raw comparison printed "-34%", which reads as collapse rather than "the year is
   *    two-thirds done". Each partial year therefore carries `priorYearToSameDate`, the same Jan-1
   *    to-this-date slice of the year before, so the growth beside it is like-for-like.
   *
   * 2. THE FIRST YEAR IS THE FEED STARTING, NOT A BUSINESS. 2022 holds 141 policies against 2023's
   *    10,482 — a "+7334%" that describes an upload, not trading. Any year holding under a tenth of
   *    the median is flagged partial too, so the UI can render it as a stub rather than a boom.
   */
  const yearEnd = `${asOf.slice(0, 4)}-12-31`
  const monthDay = asOf.slice(5)

  const result = await db.execute(sql`
    WITH od AS (${odPolicyUnionSql(brands)})
    SELECT
      EXTRACT(YEAR FROM start_date)::int AS year,
      COUNT(*)::int                      AS policies,
      COALESCE(SUM(premium), 0)::float8  AS premium,
      -- The Jan-1-to-same-month-day slice of each year, for like-for-like comparison.
      COUNT(*) FILTER (
        WHERE to_char(start_date, 'MM-DD') <= ${monthDay}
      )::int AS policies_to_date,
      COALESCE(SUM(premium) FILTER (
        WHERE to_char(start_date, 'MM-DD') <= ${monthDay}
      ), 0)::float8 AS premium_to_date
    FROM od
    WHERE start_date IS NOT NULL
      AND start_date <= ${yearEnd}::date
    GROUP BY 1
    ORDER BY 1
  `)

  const rows = rowsOf(result).map((row) => ({
    year: num(row.year),
    policies: num(row.policies),
    premium: num(row.premium),
    policiesToDate: num(row.policies_to_date),
    premiumToDate: num(row.premium_to_date),
  }))

  const currentYear = Number(asOf.slice(0, 4))
  const counts = rows.map((r) => r.policies).filter((n) => n > 0).sort((a, b) => a - b)
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0
  const stubThreshold = median / 10

  return rows.map((row, index) => {
    const isCurrent = row.year >= currentYear
    const isStub = median > 0 && row.policies < stubThreshold
    const previous = rows[index - 1]
    return {
      year: row.year,
      policies: row.policies,
      premium: row.premium,
      partial: isCurrent || isStub,
      ...(isCurrent && previous
        ? { priorYearToSameDate: { policies: previous.policiesToDate, premium: previous.premiumToDate } }
        : {}),
    }
  })
}

/**
 * Retention by expiry cohort: of the vehicles whose OD policy expired in month M, how many took
 * another one with us?
 *
 * ⚠️ The follow-on policy is allowed to start up to 30 days BEFORE the old one expires. Customers
 * routinely renew early, and a strict `start > expiry` test scores every one of those as a lapse —
 * which would understate retention badly and send the calling team after people who already paid.
 *
 * ⚠️ Cohorts newer than the grace window are EXCLUDED, not shown as 0%. A policy that expired
 * yesterday has not had a chance to renew; including it would drag the headline down every day and
 * make the number look like a collapse rather than an artefact.
 */
async function fetchCohorts(brands: InsuranceBrandId[], asOf: string, graceDays: number): Promise<RetentionCohort[]> {
  const result = await db.execute(sql`
    WITH od AS (${odPolicyUnionSql(brands)}),
    /*
     * ⚠️ LEAD, not a correlated EXISTS. The obvious "does a later policy exist for this chassis"
     * subquery re-scans the whole union once per expired policy — across ~41k own-damage rows that
     * did not finish inside two minutes. LEAD answers the same question in a single ordered pass:
     * the next policy this vehicle took is simply the next row in its own partition.
     */
    ranked AS (
      SELECT
        chassis_no, expiry_date, start_date, premium,
        LEAD(start_date) OVER (PARTITION BY chassis_no ORDER BY start_date NULLS FIRST, expiry_date) AS next_start
      FROM od
    ),
    judged AS (
      SELECT
        to_char(expiry_date, 'YYYY-MM') AS month,
        premium,
        -- Renewed early counts as retained: customers routinely re-book before expiry, and a strict
        -- next_start > expiry_date test would score every one of them as a lapse.
        (next_start IS NOT NULL AND next_start >= expiry_date - INTERVAL '30 days') AS retained
      FROM ranked
      WHERE expiry_date IS NOT NULL
        AND expiry_date < (${asOf}::date - (${graceDays} || ' days')::interval)
    )
    SELECT
      month,
      COUNT(*)::int                                                   AS expired,
      COUNT(*) FILTER (WHERE retained)::int                           AS retained,
      COALESCE(SUM(premium) FILTER (WHERE retained), 0)::float8       AS premium_retained,
      COALESCE(SUM(premium) FILTER (WHERE NOT retained), 0)::float8   AS premium_lost
    FROM judged
    GROUP BY month
    ORDER BY month
  `)
  return rowsOf(result).map((row) => {
    const expired = num(row.expired)
    const retained = num(row.retained)
    return {
      month: String(row.month),
      expired,
      retained,
      lapsed: expired - retained,
      retentionPct: expired > 0 ? (retained / expired) * 100 : null,
      premiumRetained: num(row.premium_retained),
      premiumLost: num(row.premium_lost),
    }
  })
}

/** Who the book is placed with, by own-damage policy count and premium. */
async function fetchInsurers(brands: InsuranceBrandId[]): Promise<InsurerShare[]> {
  const result = await db.execute(sql`
    WITH od AS (${odPolicyUnionSql(brands)})
    SELECT
      COALESCE(insurer, 'Unknown')      AS insurer,
      COUNT(*)::int                     AS policies,
      COALESCE(SUM(premium), 0)::float8 AS premium
    FROM od
    GROUP BY 1
    ORDER BY policies DESC
    LIMIT 12
  `)
  const rows = rowsOf(result)
  const total = rows.reduce((sum, row) => sum + num(row.policies), 0)
  return rows.map((row) => ({
    insurer: String(row.insurer),
    policies: num(row.policies),
    premium: num(row.premium),
    sharePct: total > 0 ? (num(row.policies) / total) * 100 : 0,
  }))
}

/**
 * The forward order book: vehicles due to expire in each of the next 12 months.
 *
 * Deduped to ONE ROW PER VEHICLE per month via DISTINCT ON — a car with several historic policies
 * must appear once in the month its LATEST one runs out, not once per policy it has ever held.
 */
async function fetchForwardBook(brands: InsuranceBrandId[], asOf: string) {
  const result = await db.execute(sql`
    WITH od AS (${odPolicyUnionSql(brands)}),
    latest AS (
      SELECT DISTINCT ON (chassis_no) chassis_no, expiry_date, premium
      FROM od
      WHERE expiry_date IS NOT NULL
      ORDER BY chassis_no, expiry_date DESC
    )
    SELECT
      to_char(expiry_date, 'YYYY-MM')   AS month,
      COUNT(*)::int                     AS vehicles,
      COALESCE(SUM(premium), 0)::float8 AS premium
    FROM latest
    /*
     * ⚠️ FLOORED TO THE START OF THE MONTH.
     *
     * The buckets are calendar months (to_char on YYYY-MM) but the window used to start at asOf --
     * today. So the first bar was "today to month end" while its label read as the whole month: on
     * the 25th it showed about five days of renewals and looked like a collapse, and the 12-month
     * span ended mid-month, leaving a stub 13th bucket.
     *
     * Flooring both ends keeps every bucket a WHOLE month, which is what the axis claims.
     *
     * Not to be confused with RENEWAL_DUE_WINDOW_DAYS (lib/insurance-360/lifecycle.ts) -- that is a
     * rolling 60-DAY status threshold in a different module and is correct as written.
     */
    WHERE expiry_date >= date_trunc('month', ${asOf}::date)
      AND expiry_date <  (date_trunc('month', ${asOf}::date) + INTERVAL '12 months')
    GROUP BY 1
    ORDER BY 1
  `)
  return rowsOf(result).map((row) => ({
    month: String(row.month),
    vehicles: num(row.vehicles),
    premium: num(row.premium),
  }))
}

/**
 * The classified-policy CTE every depth query below builds on.
 *
 * WARNING: ONE ordered pass per vehicle using LAG/LEAD. The natural way to write "was this renewed"
 * is a correlated EXISTS per policy, which re-scans the whole ~41k-row union each time and did not
 * finish inside two minutes on this data. Everything here is window functions over a single sort.
 */
function classifiedPoliciesSql(brands: InsuranceBrandId[], asOf: string, graceDays: number) {
  return sql`
    WITH od AS (${odPolicyUnionSql(brands)}),
    seq AS (
      SELECT
        chassis_no, start_date, expiry_date, premium, insurer, model_name, dealer_code, ncb_slab,
        ROW_NUMBER() OVER (PARTITION BY chassis_no ORDER BY start_date NULLS FIRST, expiry_date) AS seq_no,
        LAG(expiry_date)  OVER (PARTITION BY chassis_no ORDER BY start_date NULLS FIRST, expiry_date) AS prev_expiry,
        LEAD(start_date)  OVER (PARTITION BY chassis_no ORDER BY start_date NULLS FIRST, expiry_date) AS next_start
      FROM od
    ),
    classified AS (
      SELECT *,
        (start_date - prev_expiry)::int AS gap_days,
        CASE
          WHEN seq_no = 1 THEN 'new'
          WHEN prev_expiry IS NULL THEN 'new'
          WHEN start_date <= prev_expiry + ${graceDays}::int THEN 'renewed'
          ELSE 'won_back'
        END AS entry_kind,
        (next_start IS NULL
          AND expiry_date IS NOT NULL
          AND expiry_date < (${asOf}::date - (${graceDays} || ' days')::interval)) AS is_lost
      FROM seq
    )
  `
}

/** Customers gained, kept, recovered and lost, month by month. */
async function fetchMovement(brands: InsuranceBrandId[], asOf: string, graceDays: number): Promise<CustomerMovementPoint[]> {
  const result = await db.execute(sql`
    ${classifiedPoliciesSql(brands, asOf, graceDays)}
    , gained AS (
      SELECT to_char(start_date, 'YYYY-MM') AS month, entry_kind, premium
      FROM classified WHERE start_date IS NOT NULL
    ),
    lost_rows AS (
      SELECT to_char(expiry_date, 'YYYY-MM') AS month, premium
      FROM classified WHERE is_lost
    ),
    gained_agg AS (
      SELECT month,
        COUNT(*) FILTER (WHERE entry_kind = 'new')::int      AS new_customers,
        COUNT(*) FILTER (WHERE entry_kind = 'renewed')::int  AS renewed,
        COUNT(*) FILTER (WHERE entry_kind = 'won_back')::int AS won_back,
        COALESCE(SUM(premium) FILTER (WHERE entry_kind = 'new'), 0)::float8 AS premium_new
      FROM gained GROUP BY month
    ),
    lost_agg AS (
      SELECT month, COUNT(*)::int AS lost, COALESCE(SUM(premium), 0)::float8 AS premium_lost
      FROM lost_rows GROUP BY month
    )
    SELECT
      COALESCE(g.month, l.month)          AS month,
      COALESCE(g.new_customers, 0)::int   AS new_customers,
      COALESCE(g.renewed, 0)::int         AS renewed,
      COALESCE(g.won_back, 0)::int        AS won_back,
      COALESCE(l.lost, 0)::int            AS lost,
      COALESCE(g.premium_new, 0)::float8  AS premium_new,
      COALESCE(l.premium_lost, 0)::float8 AS premium_lost
    FROM gained_agg g
    FULL OUTER JOIN lost_agg l ON l.month = g.month
    ORDER BY 1
  `)
  return rowsOf(result).map((row) => {
    const newCustomers = num(row.new_customers)
    const wonBack = num(row.won_back)
    const lost = num(row.lost)
    // A month is judgeable only once every policy that expired in it has had the full grace period.
    const cutoff = new Date(asOf)
    cutoff.setDate(cutoff.getDate() - graceDays)
    const monthEnd = String(row.month) + '-31'
    return {
      month: String(row.month),
      newCustomers,
      renewed: num(row.renewed),
      wonBack,
      lost,
      net: newCustomers + wonBack - lost,
      lossesFinal: monthEnd < cutoff.toISOString().slice(0, 10),
      premiumNew: num(row.premium_new),
      premiumLost: num(row.premium_lost),
    }
  })
}

/**
 * Where cover leaks - the models and branches losing the most vehicles.
 *
 * Reported as a RATE alongside the count, because the two answer different questions: the largest
 * absolute loss is usually just the best-selling model, while a high lapse RATE on a small model is
 * the one actually worth investigating.
 */
async function fetchLeaks(brands: InsuranceBrandId[], asOf: string, graceDays: number) {
  const build = async (column: 'model_name' | 'dealer_code'): Promise<LeakPoint[]> => {
    const result = await db.execute(sql`
      ${classifiedPoliciesSql(brands, asOf, graceDays)}
      SELECT
        COALESCE(${sql.raw(column)}, 'Unknown') AS key,
        COUNT(*) FILTER (WHERE expiry_date < (${asOf}::date - (${graceDays} || ' days')::interval))::int AS expired,
        COUNT(*) FILTER (WHERE is_lost)::int AS lost,
        COALESCE(SUM(premium) FILTER (WHERE is_lost), 0)::float8 AS premium_lost
      FROM classified
      GROUP BY 1
      HAVING COUNT(*) FILTER (WHERE is_lost) > 0
      ORDER BY lost DESC
      LIMIT 10
    `)
    return rowsOf(result).map((row) => {
      const expired = num(row.expired)
      const lost = num(row.lost)
      return {
        key: String(row.key),
        expired,
        lost,
        lapsePct: expired > 0 ? (lost / expired) * 100 : null,
        premiumLost: num(row.premium_lost),
      }
    })
  }
  const byModel = await build('model_name')
  const byBranch = await build('dealer_code')
  return { byModel, byBranch }
}

/**
 * When renewals actually happen, relative to the previous policy expiring.
 *
 * This is the operationally useful one: if most renewals land in the week before expiry, a calling
 * campaign that starts on expiry day is already too late for the bulk of the book.
 */
async function fetchTiming(brands: InsuranceBrandId[], asOf: string, graceDays: number): Promise<RenewalTimingBucket[]> {
  const result = await db.execute(sql`
    ${classifiedPoliciesSql(brands, asOf, graceDays)}
    SELECT
      CASE
        WHEN gap_days <  -7 THEN 'early'
        WHEN gap_days <=  7 THEN 'on_time'
        WHEN gap_days <= 30 THEN 'late'
        WHEN gap_days <= 90 THEN 'recovered'
        ELSE 'won_back'
      END AS bucket,
      COUNT(*)::int AS policies
    FROM classified
    WHERE gap_days IS NOT NULL AND seq_no > 1
    GROUP BY 1
  `)
  const labels: Record<string, string> = {
    early: 'Renewed early (8+ days before expiry)',
    on_time: 'On time (within a week of expiry)',
    late: 'Late (1-30 days after)',
    recovered: 'Recovered (31-90 days after)',
    won_back: 'Won back (90+ days after)',
  }
  const order: RenewalTimingBucket['bucket'][] = ['early', 'on_time', 'late', 'recovered', 'won_back']
  const found = new Map(rowsOf(result).map((row) => [String(row.bucket), num(row.policies)]))
  return order.map((bucket) => ({ bucket, label: labels[bucket], policies: found.get(bucket) ?? 0 }))
}

/**
 * How urgent the forward book is right now.
 *
 * WARNING: DISTINCT ON per vehicle, on the LATEST policy. A car with several historic policies must
 * be counted once, in the bucket its current cover falls into - not once per policy it ever held.
 */
async function fetchUrgency(brands: InsuranceBrandId[], asOf: string, graceDays: number): Promise<UrgencyBucket[]> {
  const result = await db.execute(sql`
    WITH od AS (${odPolicyUnionSql(brands)}),
    latest AS (
      SELECT DISTINCT ON (chassis_no) chassis_no, expiry_date, premium
      FROM od WHERE expiry_date IS NOT NULL
      ORDER BY chassis_no, expiry_date DESC
    )
    SELECT
      CASE
        WHEN expiry_date <  ${asOf}::date THEN 'overdue'
        WHEN expiry_date <= ${asOf}::date + 7  THEN 'week'
        WHEN expiry_date <= ${asOf}::date + 30 THEN 'month'
        ELSE 'quarter'
      END AS bucket,
      COUNT(*)::int AS vehicles,
      COALESCE(SUM(premium), 0)::float8 AS premium
    FROM latest
    WHERE expiry_date >= (${asOf}::date - (${graceDays} || ' days')::interval)
      AND expiry_date <= ${asOf}::date + 90
    GROUP BY 1
  `)
  const labels: Record<string, string> = {
    overdue: 'Already expired - still recoverable',
    week: 'Expiring within 7 days',
    month: 'Expiring in 8-30 days',
    quarter: 'Expiring in 31-90 days',
  }
  const order: UrgencyBucket['bucket'][] = ['overdue', 'week', 'month', 'quarter']
  const found = new Map(rowsOf(result).map((row) => [String(row.bucket), { vehicles: num(row.vehicles), premium: num(row.premium) }]))
  return order.map((bucket) => ({
    bucket,
    label: labels[bucket],
    vehicles: found.get(bucket)?.vehicles ?? 0,
    premium: found.get(bucket)?.premium ?? 0,
  }))
}

/**
 * Retention split by NCB slab and by premium band.
 *
 * Both answer the same shape of question the headline rate cannot: WHICH customers leave. A book
 * losing its cheapest, no-bonus policies is in a completely different position from one losing its
 * long-tenured, high-NCB customers, yet both can show the same overall retention.
 *
 * Segmented on the EXPIRING policy — what the customer had when the decision was made, not what
 * they hold now (a renewed customer's current NCB has already stepped up, which would bias every
 * high slab towards "retained" by construction).
 */
async function fetchSegments(brands: InsuranceBrandId[], asOf: string, graceDays: number) {
  const judgeable = sql`
    expiry_date IS NOT NULL
      AND expiry_date < (${asOf}::date - (${graceDays} || ' days')::interval)
  `

  const ncbResult = await db.execute(sql`
    ${classifiedPoliciesSql(brands, asOf, graceDays)}
    SELECT
      COALESCE(ncb_slab, 'Not recorded') AS key,
      -- Sort numerically; 'Not recorded' goes last rather than wherever the text sort puts it.
      COALESCE((ncb_slab)::numeric, 999)  AS ord,
      COUNT(*)::int                       AS expired,
      COUNT(*) FILTER (WHERE NOT is_lost)::int AS retained,
      COALESCE(SUM(premium) FILTER (WHERE is_lost), 0)::float8 AS premium_lost
    FROM classified
    WHERE ${judgeable}
    GROUP BY 1, 2
    ORDER BY ord
  `)

  const bandResult = await db.execute(sql`
    ${classifiedPoliciesSql(brands, asOf, graceDays)}
    SELECT
      CASE
        WHEN premium IS NULL      THEN 'Not recorded'
        WHEN premium <  10000     THEN 'Under 10k'
        WHEN premium <  20000     THEN '10k - 20k'
        WHEN premium <  35000     THEN '20k - 35k'
        WHEN premium <  50000     THEN '35k - 50k'
        ELSE '50k and above'
      END AS key,
      CASE
        WHEN premium IS NULL      THEN 9
        WHEN premium <  10000     THEN 1
        WHEN premium <  20000     THEN 2
        WHEN premium <  35000     THEN 3
        WHEN premium <  50000     THEN 4
        ELSE 5
      END AS ord,
      COUNT(*)::int                            AS expired,
      COUNT(*) FILTER (WHERE NOT is_lost)::int AS retained,
      COALESCE(SUM(premium) FILTER (WHERE is_lost), 0)::float8 AS premium_lost
    FROM classified
    WHERE ${judgeable}
    GROUP BY 1, 2
    ORDER BY ord
  `)

  const shape = (result: unknown, suffix = ''): SegmentRetention[] =>
    rowsOf(result).map((row) => {
      const expired = num(row.expired)
      const retained = num(row.retained)
      const key = String(row.key)
      return {
        key: key === 'Not recorded' ? key : `${key}${suffix}`,
        order: num(row.ord),
        expired,
        retained,
        retentionPct: expired > 0 ? (retained / expired) * 100 : null,
        premiumLost: num(row.premium_lost),
      }
    })

  return { byNcb: shape(ncbResult, '%'), byPremiumBand: shape(bandResult) }
}

export async function getRenewalAnalytics(input: {
  asOf: string
  brands?: InsuranceBrandId[]
  /** Days a customer is given to renew before a cohort is judged. Default 30. */
  graceDays?: number
}): Promise<RenewalAnalytics> {
  const brands = (input.brands?.length ? input.brands : Object.keys(INSURANCE_BRANDS) as InsuranceBrandId[])
  const graceDays = Math.min(Math.max(input.graceDays ?? 30, 0), 180)

  /*
   * Sequential, not Promise.all. Each of these scans the same three-table union; firing them
   * together put four heavy queries on one transport-bound pooler at once, which is the shape this
   * repo has already been burned by (lib/db/concurrency.ts records aggregates that never completed).
   * They are cached, so the cost is paid once per window.
   */
  const yoy = await fetchYoy(brands, input.asOf)
  const cohorts = await fetchCohorts(brands, input.asOf, graceDays)
  const insurers = await fetchInsurers(brands)
  const forwardBook = await fetchForwardBook(brands, input.asOf)
  const movement = await fetchMovement(brands, input.asOf, graceDays)
  const leaks = await fetchLeaks(brands, input.asOf, graceDays)
  const timing = await fetchTiming(brands, input.asOf, graceDays)
  const urgency = await fetchUrgency(brands, input.asOf, graceDays)
  const segments = await fetchSegments(brands, input.asOf, graceDays)

  const totals = cohorts.reduce(
    (acc, cohort) => ({
      expired: acc.expired + cohort.expired,
      retained: acc.retained + cohort.retained,
      premiumRetained: acc.premiumRetained + cohort.premiumRetained,
      premiumLost: acc.premiumLost + cohort.premiumLost,
    }),
    { expired: 0, retained: 0, premiumRetained: 0, premiumLost: 0 },
  )

  return {
    generatedAt: new Date().toISOString(),
    asOf: input.asOf,
    brands,
    yoy,
    retention: {
      expired: totals.expired,
      retained: totals.retained,
      lapsed: totals.expired - totals.retained,
      retentionPct: totals.expired > 0 ? (totals.retained / totals.expired) * 100 : null,
      premiumRetained: totals.premiumRetained,
      premiumLost: totals.premiumLost,
    },
    cohorts,
    insurers,
    forwardBook,
    movement,
    leaks,
    timing,
    urgency,
    segments,
  }
}
