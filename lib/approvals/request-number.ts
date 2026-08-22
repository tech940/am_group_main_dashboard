import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Allocate the next per-brand request number — KIA_0001, HYUNDAI_0001, PLATINUM_0001.
 *
 * ── Why a number at all ───────────────────────────────────────────────────────────────────────
 * The approvals table used to show a POSITIONAL index in its "#" column. That is not an identifier:
 * it changes with sorting, filtering, paging, and every new submission. The only stable handle was
 * a uuid, which nobody can read out over a phone. This gives each request a short, brand-scoped
 * name that survives every view and prints on the voucher.
 *
 * ── Why it is one statement ───────────────────────────────────────────────────────────────────
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` is atomic: the row is locked for the duration, so
 * two concurrent submissions cannot read the same value. The obvious alternatives are both wrong
 * here — `SELECT MAX(seq)+1` and `COUNT(*)+1` each race, and the create endpoint is DELIBERATELY
 * unauthenticated public intake, so nothing upstream serialises submissions.
 *
 * A unique index on request_no backs this up, so a future code path that bypasses this function
 * fails loudly instead of quietly issuing a duplicate.
 */

/**
 * Is migration 0039 applied yet?
 *
 * ⚠️ This exists because migrations in this repo are applied BY HAND and routinely lag the code —
 * the drizzle journal carries a single entry against twenty-odd SQL files. Selecting or inserting
 * `request_no` before 0039 runs fails the whole query with Postgres 42703 and takes the approvals
 * list down with it, which is exactly what happened. An ADDITIVE, nullable column must never be
 * able to do that: the section degrades to "no request numbers yet" instead.
 *
 * Cached for the process lifetime. The answer only changes when someone applies a migration, which
 * is a deploy-shaped event, and a per-request information_schema round trip on a latency-bound
 * connection is not free.
 */
let readyCache: boolean | null = null

export async function approvalRequestNumbersReady(): Promise<boolean> {
  if (readyCache !== null) return readyCache
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'kia_approval_requests'
            AND column_name = 'request_no')::int AS has_column,
        (to_regclass('public.approval_number_counters') IS NOT NULL)::int AS has_counters
    `)
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])
    const row = rows[0] as { has_column?: unknown; has_counters?: unknown } | undefined
    readyCache = Number(row?.has_column) > 0 && Number(row?.has_counters) > 0
    if (!readyCache) {
      console.warn('[approvals] migration 0039 is not applied — request numbers are disabled until it is.')
    }
    return readyCache
  } catch {
    readyCache = false
    return false
  }
}

/** Pad to four, then let it grow: KIA_0001 … KIA_9999 … KIA_10000. */
function formatRequestNo(brand: string, seq: number): string {
  return `${brand}_${String(seq).padStart(4, '0')}`
}

/**
 * @param brand the submitting brand ('kia', 'hyundai', 'platinum', 'mg'). Blank falls back to 'kia'
 *              because the column post-dates the first 123 requests, which were all KIA.
 * @returns e.g. "HYUNDAI_0003", or null if the counter could not be read — see below.
 */
export async function allocateRequestNumber(brand: string | null | undefined): Promise<string | null> {
  const brandKey = String(brand ?? '').trim().toUpperCase() || 'KIA'

  // Before 0039 there is no counter table; asking for a number would throw and lose the request.
  if (!(await approvalRequestNumbersReady())) return null

  try {
    const result = await db.execute(sql`
      INSERT INTO approval_number_counters (brand, next_value)
      VALUES (${brandKey}, 2)
      ON CONFLICT (brand) DO UPDATE
        SET next_value = approval_number_counters.next_value + 1,
            updated_at = now()
      RETURNING (approval_number_counters.next_value - 1) AS allocated
    `)

    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])
    const first = rows[0] as { allocated?: unknown } | undefined
    const allocated = Number(first?.allocated)

    /*
     * Both branches are already correct, verified against the live database in a rolled-back
     * transaction: a fresh brand inserts next_value = 2 and RETURNING gives 2 - 1 = 1; a conflicting
     * insert sets next_value = old + 1 and RETURNING gives old. Ten parallel allocations produced
     * ten distinct numbers. The guard below is only for a malformed driver response.
     */
    if (!Number.isFinite(allocated) || allocated < 1) return formatRequestNo(brandKey, 1)
    return formatRequestNo(brandKey, allocated)
  } catch (error) {
    /*
     * Returning null rather than throwing is deliberate. A request that reaches this point is a real
     * payment someone needs approved; losing it because a counter row is unavailable would be worse
     * than storing it without a display number. The row still has its uuid, and migration 0039's
     * backfill query is written to assign numbers to any row where request_no IS NULL, so a gap is
     * recoverable by re-running that one statement.
     */
    console.error('[approvals] Could not allocate a request number for brand %s:', brandKey, error)
    return null
  }
}
