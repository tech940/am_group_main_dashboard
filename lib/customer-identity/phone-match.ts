import 'server-only'

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pgArrayLiteral } from '@/lib/db/pg-array'
import { getCachedData } from '@/lib/redis/cache-utils'

/**
 * Resolve a phone number to a person we already know.
 *
 * Two unrelated sections need this and neither owns it, which is why it lives here rather than
 * under lib/callyzer/ where it started:
 *   - Call Analysis (Callyzer)  — reads `callyzer_calls` in the main database.
 *   - AM Group CRE Call Analysis — reads a SEPARATE Supabase project (lib/cre-calls/cre-supabase.ts).
 * Both end up with a bag of phone numbers and no idea who they belong to. Callyzer stamps
 * client_name = "Unknown" on 98% of rows; the CRE handsets carry the CRE's personal address book,
 * which names colleagues, not customers. Our own enquiry feeds are the only place the answer lives.
 *
 * ⚠️ Do NOT fork this for a third caller. An earlier copy of the KIA-only version drifted and the
 * two disagreed about who a number belonged to.
 *
 * ── The normalisation contract ────────────────────────────────────────────────────────────────
 * Both sides are reduced to the LAST TEN DIGITS. Callyzer stores the country code separately, the
 * CRE handsets store four different formats for the same number (bare 10, +91, 91, leading 0 — 217
 * numbers appear under more than one of them), and our own tables hold free text typed by staff.
 *
 * The SQL expression must stay character-for-character identical to the functional indexes in
 * migration 0026, or the planner silently stops using them and every lookup seq-scans 226k rows:
 *     RIGHT(regexp_replace(COALESCE(col, ''), '\D', '', 'g'), 10)
 * In TypeScript source that pattern is written '\\D' — a two-character string holding ONE backslash.
 * That is CORRECT and verified against the live index definition; `pg_indexes.indexdef` reads
 * `'\D'::text`. Writing a single '\D' in source would compile to the bare letter D and strip only
 * the letter D, matching nothing. Do not "fix" it.
 */

/** The four places we can recognise a number, in descending order of how much they tell us. */
export const MATCH_SOURCES = ['booking', 'kia', 'hyundai', 'platinum'] as const
export type MatchSource = (typeof MATCH_SOURCES)[number]

/** Which enquiry feed to trust first when one number appears in more than one brand. */
export type PreferredBrand = 'kia' | 'hyundai' | 'platinum' | null

export type CustomerMatch = {
  phone10: string
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  status: string | null
  consultant: string | null
  source: MatchSource
  /** Enquiry date (or booking date) behind this identity, so the UI can show how stale it is. */
  refDate: string | null
  /**
   * How many DIFFERENT names this number resolves to across all sources.
   *
   * >1 means the number is shared — a household line, a dealer desk, a recycled SIM. The caller
   * decides what to do with it; this module reports rather than silently picking a winner.
   */
  distinctNames: number
}

const CACHE_TTL_SECONDS = 10 * 60

/**
 * Last 10 digits, or '' when there aren't 10.
 *
 * Deliberately permissive — it is the normaliser, not the validator. Callers that are about to
 * spend a query on a number should use {@link lookupKey}, which additionally rejects things that
 * cannot be an Indian mobile.
 */
export function phone10(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

/**
 * Numbers that are real ten-digit strings but cannot identify a customer.
 *
 * Repdigits and keyboard-walk numbers are what staff type when a customer refuses to give one, and
 * they DO appear in the enquiry feeds against several different names — so looking them up returns
 * a confident, wrong identity rather than nothing.
 */
const DUMMY_KEYS = new Set([
  '0000000000', '1111111111', '2222222222', '3333333333', '4444444444',
  '5555555555', '6666666666', '7777777777', '8888888888', '9999999999',
  '1234567890', '9876543210', '9000000000', '1234512345',
])

/**
 * A number worth spending a lookup on: a plausible Indian mobile, not a dummy.
 *
 * The [6-9] guard matters because {@link phone10} happily returns the last ten digits of a landline
 * or an international number, and that slice is meaningless — `+91 22 6854 4848` becomes
 * "2268544848", and a Jammu landline `0191 2207031` becomes "4191207031", a fragment of the STD
 * code. Both would then join against whatever customer happens to own those ten digits.
 */
export function lookupKey(value: string | null | undefined): string {
  const key = phone10(value)
  if (!/^[6-9][0-9]{9}$/.test(key)) return ''
  if (DUMMY_KEYS.has(key)) return ''
  return key
}

/** Order-independent digest of the whole number set, for the cache key. */
function hashKeys(keys: string[]): string {
  return createHash('sha1').update(keys.slice().sort().join(',')).digest('hex').slice(0, 24)
}

/**
 * One number to resolve, and which brand's record to believe for it.
 *
 * A bare string uses the call-wide preference instead.
 */
export type MatchRequest = string | { number: string; preferBrand?: PreferredBrand }

/**
 * Rank a source for one row, in SQL, from that row's OWN brand preference.
 *
 * ── Why this is computed per row rather than per query ────────────────────────────────────────
 * A page of calls carries several CREs and therefore several brands. Issuing one query per brand
 * was correct but cost 2.4 SECONDS for a 50-row page — and profiling showed the queries themselves
 * run in 0.4-32 ms. The cost was purely transport: this database is reached through pgbouncer with
 * `prepare: false`, which is ~2 round trips and ~350 ms of wall time PER STATEMENT. Five statements
 * were five times that. Carrying the preference in a parallel array collapses them into one.
 *
 * A live booking always wins (rank 0): it is a car actually bought, and the only source with a
 * booking number. Otherwise the row's own brand takes 1-3 and everything else 11-13, which
 * reproduces the previous ordering exactly — preferred brand first, then kia, hyundai, platinum.
 */
function rankFor(source: Exclude<MatchSource, 'booking'>, position: number) {
  // The ranks are emitted as literals, not bound parameters. Drizzle binds parameters as text, so
  // `THEN $1 ELSE $2` makes the CASE a text expression and the UNION ALL then fails with
  // "UNION types integer and text cannot be matched" against the booking branch's literal 0.
  // These are internal constants from the line below, never user input, so raw is safe here.
  const lit = (n: number) => sql.raw(String(Math.trunc(n)))
  return sql`(CASE WHEN w.pref = ${source} THEN ${lit(position)} ELSE ${lit(position + 10)} END)`
}

/*
 * Every branch below repeats the same name guard: blank, all-digits and one/two-character strings
 * are placeholders, not identities. Measured across the three feeds these are rare (<0.4%), but
 * "show a name" is the whole point of this module, so a junk one is worse than an em dash. It is
 * written out per source rather than shared, because each source names the column differently and a
 * shared fragment would need string interpolation into SQL.
 */

export async function matchCustomers(
  requests: MatchRequest[],
  options: { preferBrand?: PreferredBrand } = {},
): Promise<Map<string, CustomerMatch>> {
  const fallbackBrand = options.preferBrand ?? null

  /*
   * Collapse to one entry per number. When the same number appears under two brands on one page,
   * the FIRST preference seen wins — arbitrary but deterministic, and the alternative (querying it
   * twice) would reintroduce the per-brand statement cost this design exists to remove.
   */
  const prefByKey = new Map<string, PreferredBrand>()
  for (const request of requests) {
    const raw = typeof request === 'string' ? request : request.number
    const key = lookupKey(raw)
    if (!key || prefByKey.has(key)) continue
    prefByKey.set(key, (typeof request === 'string' ? fallbackBrand : request.preferBrand ?? fallbackBrand) ?? null)
  }
  if (!prefByKey.size) return new Map()

  const keys = Array.from(prefByKey.keys())
  // '' rather than NULL: pgArrayLiteral emits text, and '' never equals a brand name, so an
  // unpreferred row simply takes the default ordering.
  const prefs = keys.map((k) => prefByKey.get(k) ?? '')

  /*
   * Cache on the SET of numbers AND the brand preference.
   *
   * The key must cover EVERY number and must not depend on their order. An early version used
   * `${keys.length}:${keys.slice(0, 40)}`; because the client lists are volume-sorted and barely
   * move between filter changes, two different lookups sharing their first 40 entries collided and
   * served each other's answers for ten minutes — one customer's name against another customer's
   * phone number, which is worse than showing nothing.
   *
   * The preference belongs in the key too: it reorders which source wins, so the same number set
   * has a different correct answer under a different brand. It is hashed WITH each number rather
   * than used as a prefix, because it now varies per number.
   *
   * v4 = Platinum added, source union renamed, brand preference.
   * v5 = shared-line detection compares letters only, not raw strings.
   * v6 = brand preference is PER NUMBER, so it belongs in the hashed set rather than the prefix.
   * Bump on EVERY query change, or the old shape keeps being served for ten minutes after a deploy.
   */
  const cacheKey = `customer-identity:v6:${keys.length}:${hashKeys(keys.map((k, i) => `${k}@${prefs[i]}`))}`

  const rows = await getCachedData<CustomerMatch[]>(cacheKey, async () => {
    const result = await db.execute(sql`
      WITH wanted AS (
        -- Two parallel arrays: the number, and the brand to prefer for that number.
        SELECT unnest(${pgArrayLiteral(keys)}::text[])  AS phone10,
               unnest(${pgArrayLiteral(prefs)}::text[]) AS pref
      ),
      candidate AS (
        -- Bookings: the richest record and the only one with a booking number.
        SELECT
          w.phone10,
          0                        AS rank,
          kb.booking_number::text  AS booking_number,
          kb.customer_name::text   AS customer_name,
          kb.model::text           AS model,
          kb.status::text          AS status,
          kb.consultant_name::text AS consultant,
          'booking'::text          AS source,
          kb.created_at::date      AS ref_date
        FROM wanted w
        JOIN kia_bookings kb
          ON RIGHT(regexp_replace(COALESCE(kb.customer_phone, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE kb.deleted_at IS NULL
          AND BTRIM(COALESCE(kb.customer_name, '')) <> ''
          AND LENGTH(BTRIM(kb.customer_name)) >= 3
          AND BTRIM(kb.customer_name) !~ '^[0-9]+$'

        UNION ALL

        SELECT
          w.phone10, ${rankFor('kia', 1)}, NULL::text,
          er.name_of_the_customer::text, er.model::text, er.enquiry_status::text,
          er.consultant_name::text, 'kia'::text, er.enquiry_date
        FROM wanted w
        JOIN kia_enquiry_report er
          ON RIGHT(regexp_replace(COALESCE(er.contact_number, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE BTRIM(COALESCE(er.name_of_the_customer, '')) <> ''
          AND LENGTH(BTRIM(er.name_of_the_customer)) >= 3
          AND BTRIM(er.name_of_the_customer) !~ '^[0-9]+$'

        UNION ALL

        SELECT
          w.phone10, ${rankFor('hyundai', 2)}, NULL::text,
          hr.name_of_the_customer::text, hr.model::text, hr.enquiry_status::text,
          hr.consultant_name::text, 'hyundai'::text, hr.enquiry_date
        FROM wanted w
        JOIN hyundai_enquiry_report hr
          ON RIGHT(regexp_replace(COALESCE(hr.contact_number, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE BTRIM(COALESCE(hr.name_of_the_customer, '')) <> ''
          AND LENGTH(BTRIM(hr.name_of_the_customer)) >= 3
          AND BTRIM(hr.name_of_the_customer) !~ '^[0-9]+$'

        UNION ALL

        -- AM Platinum Hyundai. The table is am_platinum_enquiry_report. It was renamed from
        -- am_platinum_hyundai_enquiry_report (the old name survives only on its pkey/sequence),
        -- so the obvious name is the WRONG one and fails at runtime, not at compile time.
        SELECT
          w.phone10, ${rankFor('platinum', 3)}, NULL::text,
          pr.name_of_the_customer::text, pr.model::text, pr.enquiry_status::text,
          pr.consultant_name::text, 'platinum'::text, pr.enquiry_date
        FROM wanted w
        JOIN am_platinum_enquiry_report pr
          ON RIGHT(regexp_replace(COALESCE(pr.contact_number, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE BTRIM(COALESCE(pr.name_of_the_customer, '')) <> ''
          AND LENGTH(BTRIM(pr.name_of_the_customer)) >= 3
          AND BTRIM(pr.name_of_the_customer) !~ '^[0-9]+$'
      ),
      /*
       * How many genuinely DIFFERENT people answer to this number across every source.
       *
       * Compared on letters only, because the same person is spelled several ways across feeds —
       * "Mandeep singh", "MANDEEP SINGH", "Mandeep  Singh". Counting distinct raw strings called
       * 250 of 908 numbers "shared" when most were one person typed twice; stripping case, spacing
       * and punctuation leaves the real household and dealer lines.
       *
       * This still cannot merge "R KUMAR" and "RAJESH KUMAR", so it slightly over-reports. That is
       * the safe direction: it weakens a claim we are unsure of rather than asserting a wrong name.
       */
      ambiguity AS (
        SELECT phone10,
               COUNT(DISTINCT UPPER(regexp_replace(customer_name, '[^A-Za-z]', '', 'g')))::int AS distinct_names
        FROM candidate
        GROUP BY phone10
      )
      SELECT DISTINCT ON (c.phone10)
        c.phone10, c.booking_number, c.customer_name, c.model, c.status, c.consultant, c.source,
        c.ref_date, a.distinct_names
      FROM candidate c
      JOIN ambiguity a ON a.phone10 = c.phone10
      -- rank picks the source; ref_date breaks ties inside one source so the newest record wins,
      -- and customer_name makes the pick deterministic when even the dates tie.
      ORDER BY c.phone10, c.rank, c.ref_date DESC NULLS LAST, c.customer_name
    `)

    const list = Array.isArray(result) ? (result as Record<string, unknown>[]) : []
    return list.map((r) => {
      const raw = String(r.source ?? '')
      // Narrow against the real list. The previous version relabelled anything unrecognised as
      // 'booking' with a null booking number — inventing a provenance claim with no compile error.
      const source = (MATCH_SOURCES as readonly string[]).includes(raw) ? (raw as MatchSource) : 'kia'
      const refDate = r.ref_date ? String(r.ref_date).slice(0, 10) : null
      return {
        phone10: String(r.phone10 ?? ''),
        bookingNumber: r.booking_number ? String(r.booking_number) : null,
        customerName: r.customer_name ? String(r.customer_name) : null,
        model: r.model ? String(r.model) : null,
        status: r.status ? String(r.status) : null,
        consultant: r.consultant ? String(r.consultant) : null,
        source,
        refDate,
        distinctNames: Number(r.distinct_names) || 1,
      }
    })
  }, CACHE_TTL_SECONDS)

  return new Map(rows.map((r) => [r.phone10, r]))
}

/** Human label for a match's provenance. Exhaustive over {@link MATCH_SOURCES}. */
export const MATCH_SOURCE_LABEL: Record<MatchSource, string> = {
  booking: 'KIA booking',
  kia: 'KIA enquiry',
  hyundai: 'Hyundai enquiry',
  platinum: 'Platinum enquiry',
}
