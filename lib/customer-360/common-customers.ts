import 'server-only'
import { sql } from 'drizzle-orm'
import { analyticsExecute } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CUSTOMER_BRANDS, type CustomerBrand } from './brands'

/**
 * COMMON CUSTOMERS — people who have bought from more than one of our brands.
 *
 * ── The matching problem ──────────────────────────────────────────────────────────────────────
 * There is no shared customer key. The DMS issues `customerid` per brand, so the same string means
 * different people at Kia and at Hyundai (measured: 0 of 506 matched pairs share an id). Phone would
 * be the natural person key, but the Hyundai and Platinum sales feeds arrive with it masked to the
 * last four digits, and Kia's is the only one held in full.
 *
 * What survives masking is the PAN suffix. Hyundai and Platinum store PAN as '*****0350F' — five
 * characters: four digits and the check letter. Kia stores it in full, so its last five compare
 * directly against theirs. PAN is a per-person national identifier, which makes it a far better
 * person key than a name or a phone fragment.
 *
 * ── Why the PAN suffix ALONE is not enough, and what is added ─────────────────────────────────
 * Five characters is a 260,000-value space. Against 23,281 Hyundai customers, any given Kia PAN has
 * roughly a 9% chance of colliding with a stranger by accident, and measured that is exactly what
 * happens: Kia to Hyundai produced 47 raw suffix matches of which only 7 survived a name check.
 * Around 90% of raw suffix matches are coincidence.
 *
 * So a match REQUIRES the PAN suffix AND the name to agree. A name alone is far too weak (this
 * region has many repeated names); a PAN suffix alone is too weak (shown above); together they are
 * strong, because a coincidental suffix collision would also have to carry the same name.
 *
 * Two confidence levels are returned and always labelled, never blended:
 *   confirmed — normalised names are identical
 *   likely    — one normalised name contains the other ('EHTSHAM AZIZ' / 'EHTSHAM AZIZ RATHER')
 *
 * ── What this actually finds, measured 2026-08-26 ─────────────────────────────────────────────
 *   Kia + Hyundai        6 confirmed,  1 likely
 *   Kia + Platinum       2 confirmed,  0 likely
 *   Hyundai + Platinum  19 confirmed,  1 likely
 *
 * Small, and correctly so. Two thirds of the Hyundai feed carries a fully masked PAN and cannot be
 * matched at all, so this is a floor on the real overlap, not a measure of it. The section says so
 * rather than presenting the figure as complete.
 *
 * ── Two false-positive traps that were found and closed ───────────────────────────────────────
 * 1. An earlier draft reported 442 confirmed Hyundai/Platinum customers. It was wrong. 13,952 of
 *    23,406 Hyundai PANs are masked to '*****' with nothing left, so they all shared the "same"
 *    suffix and joined to one another — collapsing the rule to name-only and turning every pair of
 *    namesakes into a customer. The suffix-shape guard in brandCte is what removes them.
 * 2. Of the 164 Kia/Platinum rows, 162 were "Platinum Automobiles Pvt Ltd" matching itself: the
 *    dealership as its own best customer. See OWN_ENTITY_PATTERN.
 *
 * ── This is not double-counting ───────────────────────────────────────────────────────────────
 * Checked before shipping: of the matched Hyundai/Platinum pairs, ZERO share a vehicle and ZERO
 * share a customer id. They are genuinely two different cars bought from two different entities,
 * not one sale appearing in two feeds. That check matters because both feeds carry the identical
 * 65-column Hyundai schema, and one Hyundai dealer file has already turned out to be a consolidated
 * multi-branch export.
 *
 * ⚠️ PAN IS NEVER SERIALISED. It is a national identity number, it is used here only as a join key
 * inside the database, and no column of this module's output carries it or any part of it. The UI
 * says a match was made "on PAN and name" without ever showing the value.
 */

export type CommonCustomerVehicle = {
  brand: CustomerBrand
  brandLabel: string
  customerId: string | null
  name: string | null
  outlet: string | null
  model: string | null
  invoiceDate: string | null
}

export type CommonCustomer = {
  /** Stable across requests: the two brands plus the normalised name. Never contains PAN. */
  key: string
  name: string | null
  brands: CustomerBrand[]
  confidence: 'confirmed' | 'likely'
  /** Plain-language statement of WHY these two rows were joined. Rendered to the user. */
  evidence: string
  vehicles: CommonCustomerVehicle[]
}

export type CommonCustomerResult = {
  rows: CommonCustomer[]
  total: number
  pairCounts: { pair: string; confirmed: number; likely: number }[]
  /** Brands that could not be included, and why. Never silently dropped. */
  notes: string[]
}

/** Letters only, upper case. Strips the punctuation that makes 'MOHD. ASLAM' differ from 'MOHD ASLAM'. */
const NAME = (col: string) => sql.raw(`regexp_replace(UPPER(BTRIM(COALESCE(${col}, ''))), '[^A-Z]', '', 'g')`)

/** The five characters of PAN that survive masking: four digits and the check letter. */
const PAN5 = sql.raw('RIGHT(UPPER(BTRIM(s.pan_no)), 5)')

/**
 * Our own bodies, which buy vehicles from us and must not be listed as customers.
 *
 * Without this the cross-brand list was topped by "Platinum Automobiles Pvt Ltd Unit II" matching
 * "PLATINUM AUTOMOBILES PVT LTD" — the dealership recognising itself as its own best customer. It
 * accounted for 162 of the 164 Kia-to-Platinum rows.
 *
 * ⚠️ Deliberately narrow: it names OUR entities, not companies in general. Idea Cellular, Monalisa
 * Stores and Zircon Global all appear in these feeds and are genuine corporate customers — a company
 * that buys from two of our brands is exactly what this section exists to surface. Excluding every
 * name containing "PVT LTD" would have thrown them out with the self-dealing.
 *
 * Matched against the letters-only normalised name, so punctuation and spacing cannot evade it.
 */
const OWN_ENTITY_PATTERN = '^(PLATINUMAUTOMOBILE|KCJAMMUAUTOMART|JAMMUAUTOMART|JAMMUAUTOMOBILE)'

const OUTLET = sql.raw(
  "UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), NULLIF(BTRIM(s.dealer_code), ''), '')))",
)

/*
 * invoice_date is text holding DD/MM/YYYY in every one of these feeds, while the sibling date
 * columns are real Postgres dates. The ::text cast keeps one expression valid for both — without it
 * BTRIM(date) fails the whole statement with 42883.
 *
 * No backticks in SQL comments: they terminate the surrounding template literal.
 */
const INVOICE_DATE = sql.raw(
  `CASE WHEN NULLIF(BTRIM(s.invoice_date::text), '') ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
          THEN to_date(LEFT(BTRIM(s.invoice_date::text), 10), 'DD/MM/YYYY')
        WHEN NULLIF(BTRIM(s.invoice_date::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN to_date(LEFT(BTRIM(s.invoice_date::text), 10), 'YYYY-MM-DD')
   END`,
)

/** One brand's buyers, reduced to the columns the matcher needs. */
function brandCte(brand: CustomerBrand) {
  const table = sql.raw(CUSTOMER_BRANDS[brand].salesTable)
  return sql`
    SELECT
      ${PAN5} AS pan5,
      ${NAME('s.registration_name')} AS nm,
      BTRIM(s.registration_name) AS display_name,
      UPPER(BTRIM(s.customerid)) AS customer_id,
      ${OUTLET} AS outlet,
      NULLIF(BTRIM(s.model), '') AS model,
      UPPER(BTRIM(s.vin_number)) AS vin,
      ${INVOICE_DATE} AS invoice_date
    FROM ${table} s
    WHERE COALESCE(BTRIM(s.pan_no), '') <> ''
      AND COALESCE(BTRIM(s.vin_number), '') <> ''
      AND COALESCE(BTRIM(s.registration_name), '') <> ''
      /*
       * A PAN suffix of four digits and a letter, which is the real shape of the last five PAN
       * characters.
       *
       * ⚠️ This guard is load-bearing, not tidiness. 13,952 of 23,406 Hyundai rows carry a PAN
       * masked all the way to '*****' with nothing surviving. Without the check those all share the
       * "same" key and join to each other, which collapses the match to name-only and manufactured
       * 442 false Hyundai/Platinum customers out of coincidental namesakes.
       */
      AND RIGHT(UPPER(BTRIM(s.pan_no)), 5) ~ '^[0-9]{4}[A-Z]$'
      AND ${NAME('s.registration_name')} !~ ${sql.raw(`'${OWN_ENTITY_PATTERN}'`)}
  `
}

type Row = {
  a_name: string | null
  a_customer_id: string | null
  a_outlet: string | null
  a_model: string | null
  a_invoice: string | null
  b_name: string | null
  b_customer_id: string | null
  b_outlet: string | null
  b_model: string | null
  b_invoice: string | null
  nm: string | null
  confidence: string
}

async function matchPair(left: CustomerBrand, right: CustomerBrand, limit: number) {
  return analyticsExecute<Row>(sql`
    WITH a AS (${brandCte(left)}), b AS (${brandCte(right)})
    SELECT DISTINCT ON (a.nm, a.vin, b.vin)
      a.display_name AS a_name, a.customer_id AS a_customer_id, a.outlet AS a_outlet,
      a.model AS a_model, a.invoice_date::text AS a_invoice,
      b.display_name AS b_name, b.customer_id AS b_customer_id, b.outlet AS b_outlet,
      b.model AS b_model, b.invoice_date::text AS b_invoice,
      a.nm AS nm,
      CASE WHEN a.nm = b.nm THEN 'confirmed' ELSE 'likely' END AS confidence
    FROM a
    JOIN b ON b.pan5 = a.pan5
      -- PAN suffix AND name. Either alone produces mostly strangers; see the note at the top.
      AND (b.nm = a.nm OR a.nm LIKE '%' || b.nm || '%' OR b.nm LIKE '%' || a.nm || '%')
      /*
       * A floor on the SHORTER name, because the containment rule is the weak half of the match:
       * "SUNIL" sits inside "SUNILKUMAR", "SUNILSHARMA" and "SUNILGUPTA", who are three people.
       * Eight characters is roughly a full given name plus a surname fragment.
       * An exact match is unaffected by this and only ever needs both names to be present.
       */
      AND LENGTH(a.nm) >= 8 AND LENGTH(b.nm) >= 8
      -- The same physical car in two feeds would be a duplicated export, not a second purchase.
      AND b.vin <> a.vin
    ORDER BY a.nm, a.vin, b.vin, a.invoice_date DESC NULLS LAST
    LIMIT ${limit}
  `)
}

/**
 * @param brands the brands this user may see. A pair is only matched when BOTH sides are permitted —
 *   a cross-brand view must not become a way to read a brand you were not granted.
 */
export async function listCommonCustomers(
  brands: CustomerBrand[],
  options: { limit?: number } = {},
): Promise<CommonCustomerResult> {
  const limit = Math.min(2000, Math.max(50, Number(options.limit) || 500))
  const allowed = brands.filter((brand) => brand in CUSTOMER_BRANDS)
  const notes: string[] = []

  const PAIRS: [CustomerBrand, CustomerBrand][] = [
    ['kia', 'hyundai'],
    ['kia', 'platinum'],
    ['hyundai', 'platinum'],
  ]
  const usable = PAIRS.filter(([l, r]) => allowed.includes(l) && allowed.includes(r))

  if (!usable.length) {
    return {
      rows: [],
      total: 0,
      pairCounts: [],
      notes: ['A cross-brand view needs access to at least two brands. You currently hold one.'],
    }
  }

  const cacheKey = `customer-360:common:v1:${usable.map(([l, r]) => `${l}-${r}`).join('|')}:${limit}`

  return getCachedData<CommonCustomerResult>(cacheKey, async () => {
    const byKey = new Map<string, CommonCustomer>()
    const pairCounts: CommonCustomerResult['pairCounts'] = []

    for (const [left, right] of usable) {
      let rows: Row[] = []
      try {
        rows = await matchPair(left, right, limit)
      } catch (error) {
        // One failing pair must not blank the whole section, and must not look like "no matches".
        console.error(`[customer-360/common] ${left}-${right} match failed`, error)
        notes.push(`${CUSTOMER_BRANDS[left].label} to ${CUSTOMER_BRANDS[right].label} could not be matched just now.`)
        continue
      }

      let confirmed = 0
      let likely = 0

      for (const row of rows) {
        const confidence = row.confidence === 'confirmed' ? 'confirmed' : 'likely'
        if (confidence === 'confirmed') confirmed += 1
        else likely += 1

        const key = `${left}+${right}:${row.nm || ''}`
        const existing = byKey.get(key)
        const vehicles: CommonCustomerVehicle[] = [
          {
            brand: left,
            brandLabel: CUSTOMER_BRANDS[left].label,
            customerId: row.a_customer_id,
            name: row.a_name,
            outlet: row.a_outlet,
            model: row.a_model,
            invoiceDate: row.a_invoice ? String(row.a_invoice).slice(0, 10) : null,
          },
          {
            brand: right,
            brandLabel: CUSTOMER_BRANDS[right].label,
            customerId: row.b_customer_id,
            name: row.b_name,
            outlet: row.b_outlet,
            model: row.b_model,
            invoiceDate: row.b_invoice ? String(row.b_invoice).slice(0, 10) : null,
          },
        ]

        if (existing) {
          for (const vehicle of vehicles) {
            const seen = existing.vehicles.some(
              (v) => v.brand === vehicle.brand && v.customerId === vehicle.customerId && v.model === vehicle.model
                && v.invoiceDate === vehicle.invoiceDate,
            )
            if (!seen) existing.vehicles.push(vehicle)
          }
          // A person confirmed on one pairing stays confirmed.
          if (confidence === 'confirmed') existing.confidence = 'confirmed'
          continue
        }

        byKey.set(key, {
          key,
          name: row.a_name || row.b_name,
          brands: [left, right],
          confidence,
          evidence: confidence === 'confirmed'
            ? 'Same PAN suffix and the same name in both brands.'
            : 'Same PAN suffix and a closely matching name — worth a human check.',
          vehicles,
        })
      }

      pairCounts.push({
        pair: `${CUSTOMER_BRANDS[left].label} + ${CUSTOMER_BRANDS[right].label}`,
        confirmed,
        likely,
      })
    }

    const rows = [...byKey.values()].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === 'confirmed' ? -1 : 1
      return (a.name || '').localeCompare(b.name || '')
    })

    if (allowed.length < Object.keys(CUSTOMER_BRANDS).length) {
      notes.push('Only the brands you have access to are compared.')
    }

    /*
     * Stated every time, because the number looks small and somebody will otherwise read it as "we
     * have almost no cross-brand customers" rather than "we can only see this many".
     */
    notes.push(
      'This is a floor, not a total. Around two thirds of Hyundai sales rows arrive with the PAN '
      + 'fully masked, so those customers cannot be matched to another brand at all — there are '
      + 'certainly more common customers than are listed here.',
    )

    return { rows, total: rows.length, pairCounts, notes }
    // Fifteen minutes. The underlying feeds are batch uploads, not live writes, and the match is a
    // multi-table scan that is far too expensive to repeat per page view.
  }, 900)
}
