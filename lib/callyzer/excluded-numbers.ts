import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pgArrayLiteral } from '@/lib/db/pg-array'
import { getCachedData } from '@/lib/redis/cache-utils'

/**
 * Numbers that are NOT customers.
 *
 * Why this exists: the single busiest "customer" in the call log is 7948059749 — 520 of 1,929 calls
 * (27%), present on 44 separate days, and Callyzer's own label for it is literally
 * "Am Hyundai New Virtual No". It is the lead-routing trunk, not a person, and it sat at the top of
 * the Customers tab as though it were our best account. Alongside it are 19 further 7947xxxxxx
 * numbers, each appearing once or twice on a single day — the per-call masked caller IDs the same
 * aggregator hands out. None of the 20 matches any customer record we hold.
 *
 * These are excluded from the CUSTOMER lists only. They are NOT removed from headline call volume:
 * the trunk is real traffic and hiding it would understate how many calls the dealership handles.
 * It is reported separately as a channel instead — 520 calls with 61 missed is a spend decision.
 */

export type ExclusionReason = 'trunk' | 'internal'
export type Exclusion = { label: string; reason: ExclusionReason }

const CACHE_TTL_SECONDS = 10 * 60

/**
 * Deliberately a prefix, not a hardcoded list: the aggregator mints a fresh 7947xxxxxx per call, so
 * an exact-match list would be stale within a day. The safety valve below is what makes this safe.
 */
const TRUNK_PREFIXES = ['794']

const isTrunkCandidate = (p: string) => TRUNK_PREFIXES.some((prefix) => p.startsWith(prefix))

export async function getExcludedNumbers(): Promise<Map<string, Exclusion>> {
  const rows = await getCachedData<Array<{ phone10: string } & Exclusion>>(
    'callyzer:excluded-numbers:v1',
    async () => {
      // Candidates are drawn from two sources and then filtered by ONE safety valve.
      //
      // THE SAFETY VALVE: a number is excluded only if it matches NOTHING in our customer records.
      // Silently suppressing a genuine customer is far worse than showing a trunk row, because
      // nobody would ever learn the caller was dropped. It earns its keep on the internal seed
      // immediately — 9149982323 is "VISHALI SHARMA" in delegation_contacts AND a live Hyundai
      // enquiry, and 9484200000 is a contact that is also the JAMMU AUTOMART enquiry. Both would
      // otherwise have vanished from the callback list.
      //
      // Candidates are also restricted to numbers that actually appear in the call log, which keeps
      // the set at ~200 rows so the anti-join below is driven by the small side and uses the
      // phone10 functional indexes (migration 0026).
      const rows = await db.execute(sql`
        WITH seen AS (
          SELECT DISTINCT RIGHT(regexp_replace(client_number, '\\D', '', 'g'), 10) AS phone10
          FROM callyzer_calls
          WHERE RIGHT(regexp_replace(client_number, '\\D', '', 'g'), 10) <> ''
        ),
        candidates AS (
          -- The aggregator's lines. Measured: 20 distinct numbers, 542 calls, 28% of all volume.
          SELECT s.phone10, 'trunk'::text AS reason, 'Lead-routing trunk'::text AS label
          FROM seen s
          WHERE s.phone10 LIKE ANY (${pgArrayLiteral(TRUNK_PREFIXES.map((p) => `${p}%`))}::text[])
          UNION
          -- Our own people. users.phone_number matches 0 calls today; delegation_contacts.phone
          -- matches 17 across 6 numbers. Seeding from these two means the list never goes stale as
          -- staff change, which a hand-curated list would.
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
        )
        -- 'trunk' sorts before 'internal', so DISTINCT ON keeps the more specific reason for a
        -- number that somehow qualifies as both.
        SELECT DISTINCT ON (phone10) phone10, reason, label
        FROM candidates
        WHERE phone10 NOT IN (SELECT phone10 FROM known_customers)
        ORDER BY phone10, reason
      `)

      return (Array.isArray(rows) ? rows : []).map((r) => {
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

export { isTrunkCandidate }
