import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePassDrivers, users } from '@/lib/db/schema'

/**
 * This module's own driving-licence store.
 *
 * Nothing else in lib/db/schema.ts carries a licence number. kia_employees does, but it belongs to
 * a separate application and is off-limits by decision — so a staff driver records their licence
 * here once and it pre-fills every later request, which is the re-typing the brief asks us to
 * remove. It also lets the request form refuse an expired licence up front, rather than a guard
 * discovering it at the gate with a customer waiting.
 *
 * ⚠️ Customers are deliberately NOT stored here. When a customer drives, their licence is captured
 * as a PHOTO at the gate plus a "checked by" name, and no licence number is recorded anywhere. We
 * have no lawful reason to keep a stranger's government ID in a dealership dashboard, and a photo
 * on an audited gate event is what actually gets checked in a dispute.
 */

export type GatePassDriverProfile = {
  userId: string
  fullName: string
  email: string
  role: string
  licenceNo: string
  licenceExpiry: string | null
  phone: string | null
  /** The name as printed on the card — what the guard actually checks against. */
  licenceName: string | null
  /** Private-bucket path. Never sent to a client as-is; signed on demand. */
  licenceDocPath: string | null
  /** null when no expiry is on file — unknown, which is NOT the same as valid. */
  expired: boolean | null
}

/** Licence numbers are stored normalised so the same licence typed two ways is one licence. */
export function normalizeLicence(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '')
}

/** Last 4 characters only. The full number leaves the server for nobody but its own owner. */
export function maskLicence(value: string | null | undefined): string | null {
  const raw = normalizeLicence(value)
  if (!raw) return null
  return raw.length <= 4 ? raw : `••••${raw.slice(-4)}`
}

/**
 * A Postgres DATE comes back through this driver as a JS Date, not a string — so
 * `String(row.licenceExpiry).slice(0, 10)` yields "Thu Jul 30" and every comparison silently
 * misbehaves. That exact bug broke half the scrap module. Drizzle's `date` mode gives us a string
 * here, but the comparison is written against an explicit ISO day either way.
 */
function isExpired(expiry: string | null, asOf: Date): boolean | null {
  if (!expiry) return null
  const day = String(expiry).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return day < asOf.toISOString().slice(0, 10)
}

export async function getDriverProfile(userId: string, asOf: Date): Promise<GatePassDriverProfile | null> {
  const [row] = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      licenceNo: demoGatePassDrivers.licenceNo,
      licenceExpiry: demoGatePassDrivers.licenceExpiry,
      phone: demoGatePassDrivers.phone,
      licenceName: demoGatePassDrivers.licenceName,
      licenceDocPath: demoGatePassDrivers.licenceDocPath,
      userPhone: users.phoneNumber,
    })
    .from(demoGatePassDrivers)
    .innerJoin(users, eq(users.id, demoGatePassDrivers.userId))
    .where(eq(demoGatePassDrivers.userId, userId))
    .limit(1)

  if (!row) return null
  const expiry = row.licenceExpiry ? String(row.licenceExpiry).slice(0, 10) : null
  return {
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    licenceNo: row.licenceNo,
    licenceExpiry: expiry,
    phone: row.phone || row.userPhone || null,
    licenceName: row.licenceName ?? null,
    licenceDocPath: row.licenceDocPath ?? null,
    expired: isExpired(expiry, asOf),
  }
}

/**
 * Record or update a driver's licence.
 *
 * ⚠️ The onConflictDoUpdate SET clause lists EVERY mutable column on purpose. Drizzle silently
 * drops any column you leave out of that object — the update simply does not touch it — so an
 * omission here looks like "the edit did not save" with no error anywhere. That has already bitten
 * this repo once, in the MD targets upsert.
 */
export async function upsertDriverProfile(input: {
  userId: string
  licenceNo: string
  licenceExpiry: string | null
  phone: string | null
  licenceName?: string | null
  /**
   * Omit to KEEP an existing photo. Passing undefined and passing null mean different things:
   * undefined is "leave it alone", null would wipe it. Editing an expiry must not silently drop
   * the picture somebody uploaded last month.
   */
  licenceDocPath?: string | null
  updatedBy: string
}): Promise<void> {
  const licenceNo = normalizeLicence(input.licenceNo)
  if (!licenceNo) throw new Error('A licence number is required.')

  const values = {
    licenceNo,
    licenceExpiry: input.licenceExpiry || null,
    phone: input.phone?.trim() || null,
    licenceName: input.licenceName?.trim() || null,
    updatedBy: input.updatedBy,
    updatedAt: sql`now()`,
    ...(input.licenceDocPath === undefined ? {} : { licenceDocPath: input.licenceDocPath }),
  }

  await db
    .insert(demoGatePassDrivers)
    .values({ userId: input.userId, ...values })
    .onConflictDoUpdate({ target: demoGatePassDrivers.userId, set: values })
}

/**
 * Staff who could drive, for the picker.
 *
 * Returns everyone active in scope — WITH their licence when one is on file and without when it is
 * not — rather than only those already registered. A picker that hides unregistered colleagues
 * would make the first pass for a new joiner impossible to raise, which is the kind of dead end
 * people work around by putting somebody else's name on the form.
 */
export async function listCandidateDrivers(dealerCodes: string[]): Promise<GatePassDriverProfile[]> {
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      dealers: users.dealers,
      licenceNo: demoGatePassDrivers.licenceNo,
      licenceExpiry: demoGatePassDrivers.licenceExpiry,
      phone: demoGatePassDrivers.phone,
      licenceName: demoGatePassDrivers.licenceName,
      licenceDocPath: demoGatePassDrivers.licenceDocPath,
      userPhone: users.phoneNumber,
    })
    .from(users)
    .leftJoin(demoGatePassDrivers, eq(demoGatePassDrivers.userId, users.id))
    .where(eq(users.isActive, true))

  const wanted = new Set(dealerCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))
  const asOf = new Date()

  return rows
    .filter((row) => {
      if (wanted.size === 0) return true
      // An unpinned user is offered everywhere rather than nowhere. Roughly two thirds of users
      // carry no dealer pin, and fail-closed pinning is what left four EAs unable to see any of
      // 222 approval requests.
      const pinned = String(row.dealers ?? '')
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
      if (pinned.length === 0) return true
      return pinned.some((c) => wanted.has(c))
    })
    .map((row) => {
      const expiry = row.licenceExpiry ? String(row.licenceExpiry).slice(0, 10) : null
      return {
        userId: row.userId,
        fullName: row.fullName,
        email: row.email,
        role: row.role,
        licenceNo: row.licenceNo ?? '',
        licenceExpiry: expiry,
        phone: row.phone || row.userPhone || null,
        licenceName: row.licenceName ?? null,
        licenceDocPath: row.licenceDocPath ?? null,
        expired: isExpired(expiry, asOf),
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
}
