import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mdBranchTargets } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { BRAND_TARGET_SENTINEL, isTargetBrand, salesIsBrandLevel, type TargetBrand } from './constants'
import { isValidDealerForBrand } from '@/lib/dealers/registry'

/**
 * Reads and writes md_branch_targets. The ONLY module that touches that table.
 *
 * Targets live in the app database (`db`) while actuals come from `analyticsDb`, so the two are
 * joined in JS by the reader — the same split lib/kia/sales-performance.ts already works with.
 */

export type TargetRow = {
  dealerCode: string
  year: number
  month: number
  salesUnits: number | null
  salesRevenue: number | null
  serviceRoCount: number | null
  serviceRevenue: number | null
  note: string | null
  updatedAt: string | null
}

export type TargetEntryInput = {
  dealerCode: string
  year: number
  month: number
  salesUnits: number | null
  salesRevenue: number | null
  serviceRoCount: number | null
  serviceRevenue: number | null
}

export function targetKey(dealerCode: string, year: number, month: number): string {
  return `${dealerCode}|${year}-${String(month).padStart(2, '0')}`
}

/**
 * Is migration 0043 applied yet?
 *
 * ⚠️ Migrations in this repo are applied BY HAND and routinely lag the code — the drizzle journal
 * carries one entry against forty-odd SQL files. Selecting from md_branch_targets before 0043 runs
 * fails with Postgres 42P01 and takes the WHOLE page down with an opaque "Failed to load targets",
 * even though the actuals (which come from entirely different tables) are perfectly readable.
 *
 * So the section degrades instead: the grid still renders with real actuals and empty target inputs,
 * and the UI says plainly that targets cannot be saved until the migration is applied. Same pattern,
 * and the same reasoning, as approvalRequestNumbersReady in lib/approvals/request-number.ts — which
 * exists because this exact failure already happened once on the approvals list.
 *
 * ⚠️ ASYMMETRIC CACHING, and the asymmetry is the whole point. A `true` is cached forever — a table
 * does not un-create itself, so that costs one probe per process. A `false` is cached only briefly,
 * because the moment someone applies the migration the answer changes UNDER a running server.
 * Caching the negative for the process lifetime (which is what the approvals equivalent does, and
 * what this function did first) means the banner keeps insisting the migration is missing for
 * minutes after it has been applied, and the only cure is a restart nobody knows to perform.
 */
const NOT_READY_RECHECK_MS = 15_000

let readyCache = false
let lastNegativeProbe = 0

export async function mdTargetsTableReady(): Promise<boolean> {
  if (readyCache) return true
  // Throttle only the negative path, so a missing table costs at most one probe per 15s rather than
  // one per request on a latency-bound connection.
  const now = Date.now()
  if (lastNegativeProbe && now - lastNegativeProbe < NOT_READY_RECHECK_MS) return false
  lastNegativeProbe = now

  try {
    const result = await db.execute(sql`SELECT to_regclass('public.md_branch_targets') IS NOT NULL AS ready`)
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])
    readyCache = Boolean((rows[0] as { ready?: unknown } | undefined)?.ready)
    if (!readyCache) {
      console.warn('[targets] migration 0043 is not applied — targets are read-only until it is.')
    }
    return readyCache
  } catch {
    return false
  }
}

/** Every target the MD has set for one brand in one calendar month. */
export async function getBrandTargets(brand: TargetBrand, year: number, month: number): Promise<TargetRow[]> {
  // Before 0043 there is no table. Return no targets rather than throwing — the actuals live in
  // other tables entirely and are still perfectly readable, so the page stays useful.
  if (!(await mdTargetsTableReady())) return []

  const rows = await db
    .select()
    .from(mdBranchTargets)
    .where(and(
      eq(mdBranchTargets.brand, brand),
      eq(mdBranchTargets.year, year),
      eq(mdBranchTargets.month, month),
    ))

  return rows
    .map((row) => ({
      dealerCode: row.dealerCode,
      year: row.year,
      month: row.month,
      salesUnits: row.salesUnits,
      salesRevenue: row.salesRevenue === null ? null : Number(row.salesRevenue),
      serviceRoCount: row.serviceRoCount,
      serviceRevenue: row.serviceRevenue === null ? null : Number(row.serviceRevenue),
      note: row.note,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    }))
}

/** Thrown for a payload the MD's own UI should never have produced — surfaced as a 400. */
export class TargetValidationError extends Error {}

function clampNullableInt(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new TargetValidationError(`${label} must be a number`)
  if (n < 0) throw new TargetValidationError(`${label} cannot be negative`)
  return Math.floor(n)
}

function clampNullableMoney(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new TargetValidationError(`${label} must be a number`)
  if (n < 0) throw new TargetValidationError(`${label} cannot be negative`)
  return n.toFixed(2)
}

/**
 * Bulk upsert one brand's targets for a month.
 *
 * ── Full-cell replace, deliberately ───────────────────────────────────────────────────────────
 * `SET x = excluded.x` overwrites with NULL when the client sends null, which is what makes
 * "clear this target" expressible at all. The tempting alternative, COALESCE(excluded.x, existing),
 * would make a target permanently un-clearable — and clearing is what re-enables the LY+10% auto
 * fallback for that month. So the client always sends complete cells.
 *
 * ── Validation rejects rather than drops ──────────────────────────────────────────────────────
 * A silently ignored target is worse than an error: the MD would believe a number is set that is
 * not. Every violation throws.
 */
export async function upsertBrandTargets(
  appUser: AppUser,
  brand: string,
  entries: TargetEntryInput[],
): Promise<{ saved: number }> {
  if (!(await mdTargetsTableReady())) {
    throw new TargetValidationError(
      'Targets cannot be saved yet: database migration 0043_add_md_branch_targets.sql has not been applied.',
    )
  }
  if (!isTargetBrand(brand)) throw new TargetValidationError(`Unknown brand '${brand}'`)
  const brandKey = brand as TargetBrand

  if (!Array.isArray(entries) || entries.length === 0) return { saved: 0 }
  // One month x at most a dozen scopes; this stops one request becoming an unbounded insert.
  if (entries.length > 50) throw new TargetValidationError('Too many entries in one request')

  const brandLevelSales = salesIsBrandLevel(brandKey)

  const values = entries.map((entry) => {
    const dealerCode = String(entry.dealerCode || '').trim()
    const isSentinel = dealerCode === BRAND_TARGET_SENTINEL

    if (!isSentinel && !isValidDealerForBrand(brandKey, dealerCode)) {
      throw new TargetValidationError(`'${dealerCode}' is not a branch of ${brandKey}`)
    }
    if (entry.month < 1 || entry.month > 12 || entry.year < 2000 || entry.year > 2100) {
      throw new TargetValidationError(`${entry.year}-${entry.month} is not a valid period`)
    }

    const salesUnits = clampNullableInt(entry.salesUnits, 'Sales units')
    const salesRevenue = clampNullableMoney(entry.salesRevenue, 'Sales revenue')
    const serviceRoCount = clampNullableInt(entry.serviceRoCount, 'Service RO count')
    const serviceRevenue = clampNullableMoney(entry.serviceRevenue, 'Service revenue')

    // Grain enforcement. Not a UI convenience — storing a Hyundai per-branch sales target would
    // create a number nothing can ever score, because that feed cannot split outlets.
    const hasSales = salesUnits !== null || salesRevenue !== null
    if (hasSales) {
      if (brandLevelSales && !isSentinel) {
        throw new TargetValidationError(
          `${brandKey} sales targets are set for the brand as a whole — its feed cannot split outlets`,
        )
      }
      if (!brandLevelSales && isSentinel) {
        throw new TargetValidationError(`${brandKey} sales targets are set per branch, not brand-wide`)
      }
    }
    const hasService = serviceRoCount !== null || serviceRevenue !== null
    if (hasService && isSentinel) {
      throw new TargetValidationError('Service targets are set per branch, not brand-wide')
    }

    return {
      brand: brandKey,
      dealerCode,
      year: Math.floor(entry.year),
      month: Math.floor(entry.month),
      salesUnits,
      salesRevenue,
      serviceRoCount,
      serviceRevenue,
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }
  })

  await db.insert(mdBranchTargets).values(values).onConflictDoUpdate({
    target: [mdBranchTargets.brand, mdBranchTargets.dealerCode, mdBranchTargets.year, mdBranchTargets.month],
    set: {
      salesUnits: sql`excluded.sales_units`,
      salesRevenue: sql`excluded.sales_revenue`,
      serviceRoCount: sql`excluded.service_ro_count`,
      serviceRevenue: sql`excluded.service_revenue`,
      updatedBy: sql`excluded.updated_by`,
      updatedAt: new Date(),
    },
  })

  return { saved: values.length }
}
