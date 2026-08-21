import 'server-only'

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pgArrayLiteral } from '@/lib/db/pg-array'
import { getCachedData } from '@/lib/redis/cache-utils'
import { lookupKey } from './phone-match'

/**
 * Numbers that are NOT customers, and must never be shown as one.
 *
 * Why this exists: the single busiest "customer" in the Callyzer log is 7948059749 — 520 of 1,929
 * calls (27%), on 44 separate days, and Callyzer's own label for it is literally "Am Hyundai New
 * Virtual No". It is the lead-routing trunk, not a person, and it sat at the top of the Customers
 * tab as though it were our best account. Alongside it are 19 further 7947xxxxxx numbers — the
 * per-call masked caller IDs the same aggregator hands out.
 *
 * The second class is our own people. Measured across the CRE call log: 15 numbers belong to staff
 * or delegation contacts, and SIX of those also match an enquiry row — so without this, calling a
 * colleague renders a confident customer identity next to their number. One of them, 9797434444,
 * resolves to both a person's name and to "PLATINUM AUTOMOBILES PVT LTD" — our own company.
 *
 * These are excluded from CUSTOMER IDENTITY only. They are NOT removed from headline call volume:
 * the trunk is real traffic and hiding it would understate how many calls the dealership handles.
 *
 * ── Generalised from the Callyzer-only original ───────────────────────────────────────────────
 * It used to seed candidates by scanning `callyzer_calls`, which made it structurally unusable from
 * the AM Group CRE section — whose calls live in a DIFFERENT Supabase project this database cannot
 * join to. It now takes the numbers to consider as an argument, so either caller can use it.
 */

export type ExclusionReason = 'trunk' | 'internal'
export type Exclusion = { label: string; reason: ExclusionReason }

const CACHE_TTL_SECONDS = 10 * 60

/**
 * Deliberately a prefix, not a hardcoded list: the aggregator mints a fresh 7947xxxxxx per call, so
 * an exact-match list would be stale within a day. The safety valve below is what makes that safe.
 */
const TRUNK_PREFIXES = ['794']

export const isTrunkCandidate = (p: string) => TRUNK_PREFIXES.some((prefix) => p.startsWith(prefix))

/**
 * Which of `numbers` must not be shown as a customer.
 *
 * @param numbers raw phone strings in any format; normalised and validated internally.
 */
export async function getExcludedNumbers(numbers: string[]): Promise<Map<string, Exclusion>> {
  const keys = Array.from(new Set(numbers.map(lookupKey).filter(Boolean)))
  if (!keys.length) return new Map()

  const digest = createHash('sha1').update(keys.slice().sort().join(',')).digest('hex').slice(0, 24)

  const rows = await getCachedData<Array<{ phone10: string } & Exclusion>>(
    // v2 = candidate set passed in rather than scanned from callyzer_calls, and Platinum added to
    // the safety valve. Bump on every query change.
    `customer-identity:exclusions:v2:${keys.length}:${digest}`,
    async () => {
      /*
       * THE SAFETY VALVE: a number is excluded only if it matches NOTHING in our customer records.
       * Silently suppressing a genuine customer is far worse than showing a trunk row, because
       * nobody would ever learn the caller was dropped. It earns its keep immediately — 9149982323
       * is "VISHALI SHARMA" in delegation_contacts AND a live Hyundai enquiry, and 9484200000 is a
       * contact that is also the JAMMU AUTOMART enquiry. Both would otherwise have vanished.
       *
       * ⚠️ Every source in phone-match.ts must appear here too. If the matcher can name a number
       * from a feed this valve does not check, a real customer on a trunk-prefixed number stays
       * silently suppressed.
       */
      const result = await db.execute(sql`
        WITH seen AS (
          SELECT unnest(${pgArrayLiteral(keys)}::text[]) AS phone10
        ),
        candidates AS (
          SELECT s.phone10, 'trunk'::text AS reason, 'Lead-routing trunk'::text AS label
          FROM seen s
          WHERE s.phone10 LIKE ANY (${pgArrayLiteral(TRUNK_PREFIXES.map((p) => `${p}%`))}::text[])
          UNION
          -- Our own people. Seeded from the live tables so the list never goes stale as staff
          -- change, which a hand-curated list would.
          SELECT s.phone10, 'internal'::text, 'Internal / staff'::text
          FROM seen s
          WHERE s.phone10 IN (
            SELECT RIGHT(regexp_replace(COALESCE(phone_number, ''), '\\D', '', 'g'), 10) FROM users
            UNION
            SELECT RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) FROM delegation_contacts
          )
        ),
        known_customers AS (
          SELECT c.phone10 FROM candidates c
          JOIN kia_bookings kb
            ON RIGHT(regexp_replace(COALESCE(kb.customer_phone, ''), '\\D', '', 'g'), 10) = c.phone10
          WHERE kb.deleted_at IS NULL
          UNION
          SELECT c.phone10 FROM candidates c
          JOIN kia_enquiry_report er
            ON RIGHT(regexp_replace(COALESCE(er.contact_number, ''), '\\D', '', 'g'), 10) = c.phone10
          UNION
          SELECT c.phone10 FROM candidates c
          JOIN hyundai_enquiry_report hr
            ON RIGHT(regexp_replace(COALESCE(hr.contact_number, ''), '\\D', '', 'g'), 10) = c.phone10
          UNION
          SELECT c.phone10 FROM candidates c
          JOIN am_platinum_enquiry_report pr
            ON RIGHT(regexp_replace(COALESCE(pr.contact_number, ''), '\\D', '', 'g'), 10) = c.phone10
        )
        -- 'internal' sorts before 'trunk', so a number that is both is reported as staff — the more
        -- specific and more embarrassing of the two to get wrong.
        SELECT DISTINCT ON (phone10) phone10, reason, label
        FROM candidates
        WHERE phone10 NOT IN (SELECT phone10 FROM known_customers)
        ORDER BY phone10, reason
      `)

      return (Array.isArray(result) ? result : []).map((r) => {
        const row = r as { phone10?: string; reason?: string; label?: string }
        return {
          phone10: String(row.phone10 || ''),
          label: String(row.label || 'Excluded'),
          reason: (row.reason === 'internal' ? 'internal' : 'trunk') as ExclusionReason,
        }
      }).filter((r) => r.phone10)
    },
    CACHE_TTL_SECONDS,
  )

  return new Map(rows.map((r) => [r.phone10, { label: r.label, reason: r.reason }]))
}
