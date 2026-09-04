import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses } from '@/lib/db/schema'
import { formatIndiaDateTime } from '@/lib/date-time'
import { getKiaBranchLabel } from '@/lib/kia/dealer-branch'
import { maskLicence } from './drivers'
import type { GateTokenPurpose } from './token'

/**
 * What an unauthenticated guard is allowed to see.
 *
 * ⚠️ THIS IS AN ALLOWLIST, BUILT FIELD BY FIELD — never a row spread with a few keys deleted.
 * A delete-list silently leaks every column added to the table afterwards; an allowlist silently
 * omits them, which is the failure direction you want on a page anyone holding a link can open.
 *
 * The guard needs to confirm the car in front of them is the car on the pass, and that the person
 * driving it is the person named. That is all this returns. No customer contact details, no
 * requester identity, no commercial figures, no internal remarks, and no full licence number — the
 * guard checks the physical licence against the masked last four, which is what a gate check
 * actually is.
 */

export type GuardView = {
  passNo: string
  status: string
  purposeOfVisit: GateTokenPurpose
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  keyNumber: string | null
  branchLabel: string
  driverName: string
  driverLicenceMasked: string | null
  driverLicenceValid: boolean | null
  purpose: string
  purposeNote: string | null
  expectedReturnAt: string
  approvedByName: string | null
  approvedAt: string | null
  gateOutAt: string | null
  gateOutOdo: string | null
  /** Set when the pass cannot accept this action — the page explains instead of offering a form. */
  blockedReason: string | null
}

function licenceValid(expiry: unknown): boolean | null {
  if (!expiry) return null
  const day = String(expiry).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return day >= new Date().toISOString().slice(0, 10)
}

export async function buildGuardView(
  passId: string,
  purpose: GateTokenPurpose,
): Promise<GuardView | null> {
  const [row] = await db.select().from(demoGatePasses).where(eq(demoGatePasses.id, passId)).limit(1)
  if (!row) return null

  /*
   * The state machine, restated for a human. A guard holding a valid token for a pass that has
   * already moved needs a sentence, not a form and a 409 — the car is at the barrier either way.
   */
  let blockedReason: string | null = null
  if (purpose === 'out') {
    if (row.status === 'out') blockedReason = 'This vehicle has already been signed out.'
    else if (row.status === 'returned') blockedReason = 'This pass is closed — the vehicle is back.'
    else if (row.status === 'rejected') blockedReason = 'This pass was not approved.'
    else if (row.status === 'cancelled') blockedReason = 'This pass was cancelled.'
    else if (row.status === 'expired') blockedReason = 'This pass expired before the vehicle left.'
    else if (row.status === 'pending_approval') blockedReason = 'This pass has not been approved yet.'
  } else {
    if (row.status === 'returned') blockedReason = 'This vehicle has already been signed back in.'
    else if (row.status !== 'out') blockedReason = 'This vehicle is not currently signed out.'
  }

  return {
    passNo: row.passNo,
    status: row.status,
    purposeOfVisit: purpose,
    registrationNumber: row.registrationNumber,
    model: row.model,
    variant: row.variant,
    color: row.color,
    keyNumber: row.keyNumber,
    branchLabel: getKiaBranchLabel(row.dealerCode),
    driverName: row.driverName,
    driverLicenceMasked: maskLicence(row.driverLicenceNo),
    driverLicenceValid: licenceValid(row.driverLicenceExpiry),
    purpose: row.purpose,
    purposeNote: row.purposeNote,
    // formatIndiaDateTime returns undefined for an unparseable value; a guard needs a string, and
    // a blank where a due-time should be reads as "no deadline" rather than "we do not know".
    expectedReturnAt: formatIndiaDateTime(row.expectedReturnAt) ?? 'Not recorded',
    approvedByName: row.approvedByName,
    approvedAt: (row.approvedAt ? formatIndiaDateTime(row.approvedAt) : null) ?? null,
    // Only on the way back in, so the guard can sanity-check the closing reading.
    gateOutAt: (purpose === 'in' && row.gateOutAt ? formatIndiaDateTime(row.gateOutAt) : null) ?? null,
    gateOutOdo: purpose === 'in' ? row.gateOutOdo : null,
    blockedReason,
  }
}
