import 'server-only'

import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { clearAppUserCacheAndWait } from '@/lib/auth/app-user'
import {
  AUTO_DEACTIVATION_EXEMPT_ROLES,
  AUTO_DEACTIVATION_IDLE_DAYS,
} from '@/lib/auth/user-deactivation-config'
import { db } from '@/lib/db'
import { adminAuditLogs, users } from '@/lib/db/schema'

export { AUTO_DEACTIVATION_EXEMPT_ROLES, AUTO_DEACTIVATION_IDLE_DAYS }

/**
 * Circuit breaker. This job locks people out of the app, and it depends on last_seen_at being kept
 * fresh by lib/auth/app-user.ts. If that writer ever silently stops (bad deploy, broken pool, a
 * revert), EVERY user drifts past the idle window and one sweep would lock out the whole company.
 * So refuse to act on an implausible batch and report instead. Override with force: true.
 */
const SAFETY_ABORT_FRACTION = 0.5
const SAFETY_ABORT_FLOOR = 10

export type DeactivationCandidate = {
  id: string
  email: string
  fullName: string
  role: string
  idleDays: number
}

export type AutoDeactivationResult = {
  ok: boolean
  dryRun: boolean
  aborted: boolean
  eligible: number
  deactivated: number
  candidates: DeactivationCandidate[]
  error: string | null
  durationMs: number
}

/**
 * Deactivates every non-exempt user who has not used the app for AUTO_DEACTIVATION_IDLE_DAYS.
 *
 * "Used the app" is users.last_seen_at, NOT the last login event. Supabase sessions auto-refresh,
 * so active staff can go weeks without a login row — measured against live data, a last-login rule
 * would have deactivated 38 of 45 eligible users including 12 who were active that same day.
 *
 * Falls back to created_at when last_seen_at is null, so an account that was created and never used
 * is correctly treated as idle from creation, while a brand-new user still gets the full window to
 * sign in before anything happens to them.
 *
 * Idempotent: already-inactive users are not selected, so re-running is a no-op.
 */
export async function runAutoDeactivationSweep(
  options: { dryRun?: boolean; force?: boolean } = {}
): Promise<AutoDeactivationResult> {
  const startedAt = Date.now()
  const dryRun = Boolean(options.dryRun)
  const cutoff = Date.now() - AUTO_DEACTIVATION_IDLE_DAYS * 24 * 60 * 60 * 1000

  const base: AutoDeactivationResult = {
    ok: true,
    dryRun,
    aborted: false,
    eligible: 0,
    deactivated: 0,
    candidates: [],
    error: null,
    durationMs: 0,
  }

  // Small table (tens of rows), so select the eligible population once and filter in JS — the
  // total is needed for the circuit breaker anyway.
  const eligible = await db
    .select({
      id: users.id,
      supabaseId: users.supabaseId,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      brand: users.brand,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(
      eq(users.isActive, true),
      isNull(users.deletedAt),
      notInArray(users.role, [...AUTO_DEACTIVATION_EXEMPT_ROLES])
    ))

  const idle = eligible
    .map((user) => {
      const seenAt = (user.lastSeenAt ?? user.createdAt).getTime()
      return { user, seenAt, idleDays: (Date.now() - seenAt) / (24 * 60 * 60 * 1000) }
    })
    .filter((row) => row.seenAt < cutoff)

  base.eligible = eligible.length
  base.candidates = idle.map((row) => ({
    id: row.user.id,
    email: row.user.email,
    fullName: row.user.fullName,
    role: row.user.role,
    idleDays: Math.round(row.idleDays * 10) / 10,
  }))

  if (idle.length === 0) {
    return { ...base, durationMs: Date.now() - startedAt }
  }

  const abortLimit = Math.max(SAFETY_ABORT_FLOOR, Math.floor(eligible.length * SAFETY_ABORT_FRACTION))
  if (!options.force && idle.length > abortLimit) {
    return {
      ...base,
      ok: false,
      aborted: true,
      error: `Refusing to deactivate ${idle.length} of ${eligible.length} eligible users in one run `
        + `(limit ${abortLimit}). This usually means last_seen_at has stopped being written rather than `
        + `that everyone went idle. Investigate before re-running with force.`,
      durationMs: Date.now() - startedAt,
    }
  }

  if (dryRun) {
    return { ...base, durationMs: Date.now() - startedAt }
  }

  const ids = idle.map((row) => row.user.id)

  // One transaction so a deactivation can never land without its audit row. Locking people out of
  // the dashboard with no record of who did it or why is not an acceptable partial failure.
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(inArray(users.id, ids))

    // actorUserId null = performed by the system, not a person. The audit reader already renders a
    // null actor (app/api/admin/audit/route.ts maps actorUserId → user only when present).
    await tx.insert(adminAuditLogs).values(idle.map((row) => ({
      actorUserId: null,
      targetUserId: row.user.id,
      action: 'user.auto_deactivated',
      branch: row.user.brand,
      beforeValue: { isActive: true },
      afterValue: { isActive: false },
      reason: `No activity for ${Math.floor(row.idleDays)} days (threshold ${AUTO_DEACTIVATION_IDLE_DAYS}d)`,
      requestMetadata: { source: 'auto-deactivation-sweep' },
    })))
  })

  // Without this the user keeps working: the app-user cache is a 10-minute in-memory map PLUS a
  // 24-hour Redis entry that short-circuits the DB entirely. Redis is shared, so clearing it here
  // is what actually takes effect; other warm instances' in-memory copies lapse within 10 minutes.
  // AWAITED (not the fire-and-forget clearAppUserCache) because this runs in a cron request that
  // may freeze the moment it responds — a dropped DEL would leave a deactivated user working for
  // another 24 hours.
  const cleared = await Promise.all(idle.map((row) => clearAppUserCacheAndWait(row.user.supabaseId)))
  const staleCaches = cleared.filter((ok) => !ok).length

  return {
    ...base,
    deactivated: ids.length,
    error: staleCaches > 0
      ? `${staleCaches} user cache entries could not be cleared; those users may retain access until the 24h cache TTL lapses.`
      : null,
    durationMs: Date.now() - startedAt,
  }
}
