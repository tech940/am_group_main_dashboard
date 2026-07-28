import 'server-only'

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pgArrayLiteral } from '@/lib/db/pg-array'
import { getCachedData } from '@/lib/redis/cache-utils'

/**
 * Match caller numbers to people we already know.
 *
 * This is the one thing Callyzer structurally cannot do: 98% of its call rows carry
 * client_name = "Unknown" (measured: 6 named out of 300), and its own CRM fields are entirely
 * unused on this account (crm_status and lead_id were empty on all 300 sampled rows). But every row
 * DOES carry the phone number, and our database holds bookings and enquiries keyed by phone.
 *
 * So an anonymous "9469970618, 3 missed calls" becomes "that is booking B202600345 — SONET, sales
 * consultant Raman". Matching is done set-based in ONE query for the whole page (never per row).
 *
 * Numbers are normalised to the last 10 digits before comparison: Callyzer stores the country code
 * separately, our tables store free-text phone entered by staff (spaces, +91, leading 0).
 */

export type CustomerMatch = {
  phone10: string
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  status: string | null
  consultant: string | null
  source: 'booking' | 'enquiry' | 'hyundai'
}

const CACHE_TTL_SECONDS = 10 * 60

/** Last 10 digits — the stable part of an Indian mobile number across all our sources. */
export function phone10(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

/**
 * Order-independent digest of the whole number set, for the cache key.
 * Sorted first so the same set requested in a different order is one cache entry, not two.
 */
function hashKeys(keys: string[]): string {
  return createHash('sha1').update(keys.slice().sort().join(',')).digest('hex').slice(0, 24)
}

export async function matchCustomers(numbers: string[]): Promise<Map<string, CustomerMatch>> {
  const keys = Array.from(new Set(numbers.map(phone10).filter(Boolean)))
  if (!keys.length) return new Map()

  // Cache on the SET of numbers being asked about: the page requests the same top-N clients on
  // every load, so this is one Postgres round trip per 10 minutes rather than one per view.
  //
  // The key must cover EVERY number, and must not depend on their order. An earlier version used
  // `${keys.length}:${keys.slice(0, 40)}` — but topClients and neverConnected are both volume-sorted
  // and barely move between filter changes, so two different 150-number lookups sharing their first
  // 40 entries collided and were served each other's answers for ten minutes. That shows one
  // customer's name against another customer's phone number, which is worse than showing nothing.
  //
  // v3 = full-set hash (v2 = Hyundai added to the match). Bump on every query change, or cached
  // results from the old query keep serving.
  const cacheKey = `callyzer:cust-match:v3:${keys.length}:${hashKeys(keys)}`

  const rows = await getCachedData<CustomerMatch[]>(cacheKey, async () => {
    const result = await db.execute(sql`
      WITH wanted AS (
        SELECT unnest(${pgArrayLiteral(keys)}::text[]) AS phone10
      ),
      -- Live bookings first: they are the richest record and the most current.
      booking_match AS (
        SELECT DISTINCT ON (w.phone10)
          w.phone10,
          kb.booking_number::text AS booking_number,
          kb.customer_name::text  AS customer_name,
          kb.model::text          AS model,
          kb.status::text         AS status,
          kb.consultant_name::text AS consultant,
          'booking'::text          AS source
        FROM wanted w
        JOIN kia_bookings kb
          ON RIGHT(regexp_replace(COALESCE(kb.customer_phone, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE kb.deleted_at IS NULL
        ORDER BY w.phone10, kb.created_at DESC
      ),
      -- Fall back to the KIA DMS enquiry feed for numbers that never became a booking.
      enquiry_match AS (
        SELECT DISTINCT ON (w.phone10)
          w.phone10,
          NULL::text AS booking_number,
          er.name_of_the_customer::text AS customer_name,
          er.model::text                AS model,
          er.enquiry_status::text       AS status,
          er.consultant_name::text      AS consultant,
          'enquiry'::text               AS source
        FROM wanted w
        JOIN kia_enquiry_report er
          ON RIGHT(regexp_replace(COALESCE(er.contact_number, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE NOT EXISTS (SELECT 1 FROM booking_match b WHERE b.phone10 = w.phone10)
        ORDER BY w.phone10, er.enquiry_date DESC
      ),
      -- Then Hyundai. This is not an afterthought: 71% of the call log comes from the "AM HYUNDAI"
      -- handset, so KIA-only matching identified 4 of the top 120 callers while Hyundai identifies
      -- 45 of the same 120. Checked last so a KIA record always wins a number appearing in both.
      hyundai_match AS (
        SELECT DISTINCT ON (w.phone10)
          w.phone10,
          NULL::text AS booking_number,
          hr.name_of_the_customer::text AS customer_name,
          hr.model::text                AS model,
          hr.enquiry_status::text       AS status,
          hr.consultant_name::text      AS consultant,
          'hyundai'::text               AS source
        FROM wanted w
        JOIN hyundai_enquiry_report hr
          ON RIGHT(regexp_replace(COALESCE(hr.contact_number, ''), '\\D', '', 'g'), 10) = w.phone10
        WHERE NOT EXISTS (SELECT 1 FROM booking_match b WHERE b.phone10 = w.phone10)
          AND NOT EXISTS (SELECT 1 FROM enquiry_match e WHERE e.phone10 = w.phone10)
        ORDER BY w.phone10, hr.enquiry_date DESC
      )
      SELECT * FROM booking_match
      UNION ALL
      SELECT * FROM enquiry_match
      UNION ALL
      SELECT * FROM hyundai_match
    `)

    const list = Array.isArray(result) ? (result as Record<string, unknown>[]) : []
    return list.map((r) => ({
      phone10: String(r.phone10 ?? ''),
      bookingNumber: r.booking_number ? String(r.booking_number) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      model: r.model ? String(r.model) : null,
      status: r.status ? String(r.status) : null,
      consultant: r.consultant ? String(r.consultant) : null,
      source: (r.source === 'enquiry' || r.source === 'hyundai' ? r.source : 'booking') as CustomerMatch['source'],
    }))
  }, CACHE_TTL_SECONDS)

  return new Map(rows.map((r) => [r.phone10, r]))
}
