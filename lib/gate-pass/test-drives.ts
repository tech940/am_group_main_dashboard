import 'server-only'

import { and, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses } from '@/lib/db/schema'
import { isTestDrivePurpose, testDriveOutcome } from './status'

/**
 * Test drives that actually happened at the barrier, for the KIA Sales Report's Test Drives card.
 *
 * ── ⚠️ THIS IS NOT THE SAME NUMBER AS THE DMS FIGURE, AND MUST NEVER BE ADDED TO IT ─────────────
 * The card's existing count is enquiry rows whose `td_status` a sales consultant set to "Done" — a
 * CRM field about a LEAD. This counts gate passes — a physical record of a demo car leaving the
 * premises. They overlap heavily and neither contains the other:
 *   - a consultant can tick "test drive done" for a drive in a customer's own car, or in a car that
 *     never needed a gate pass;
 *   - a gate pass can be raised for a walk-in with no enquiry row at all.
 * There is no shared key to reconcile them on — a pass carries a VIN and a driver name, an enquiry
 * carries a customer — so summing them would double-count every drive that is in both, and no
 * arithmetic here can tell which those are. The card therefore shows them SIDE BY SIDE and says
 * which is which.
 *
 * ── Which date a drive belongs to ───────────────────────────────────────────────────────────────
 * `COALESCE(gate_out_at, created_at)`: a completed drive counts in the period the car actually left,
 * and a cancelled one — which never left — counts in the period it was raised. One rule, and it reads
 * the way a manager asks the question.
 */

export type GatePassTestDrives = {
  /** Gate passes that went out and came back. The only finished drives. */
  completed: number
  /** Raised and then called off. */
  cancelled: number
  /** Out on the road right now — real, but not yet a finished drive. */
  inProgress: number
  /** completed + cancelled + inProgress. Excludes rejected and expired, which are neither. */
  total: number
}

export const EMPTY_GATE_PASS_TEST_DRIVES: GatePassTestDrives = {
  completed: 0,
  cancelled: 0,
  inProgress: 0,
  total: 0,
}

/**
 * @param startDate inclusive, `YYYY-MM-DD` in the report's own calendar
 * @param endDateExclusive exclusive, so a single day is start..start+1 and no row is double-counted
 * @param dealerCodes the report's branch scope; empty means every branch it can see
 */
export async function countGatePassTestDrives({
  startDate,
  endDateExclusive,
  dealerCodes,
}: {
  startDate: string
  endDateExclusive: string
  dealerCodes: string[]
}): Promise<GatePassTestDrives> {
  try {
    const anchor = sql`COALESCE(${demoGatePasses.gateOutAt}, ${demoGatePasses.createdAt})`

    const where = [
      gte(anchor, sql`${startDate}::date`),
      lt(anchor, sql`${endDateExclusive}::date`),
    ]
    if (dealerCodes.length > 0) where.push(inArray(demoGatePasses.dealerCode, dealerCodes))

    /*
     * Purpose is filtered in TypeScript, not SQL, so isTestDrivePurpose stays the single definition.
     * The register is small — 43 gated passes on the whole live table — so this reads a few dozen
     * rows, and duplicating the rule as a SQL ILIKE is how the two would drift apart.
     */
    const rows = await db
      .select({ purpose: demoGatePasses.purpose, status: demoGatePasses.status })
      .from(demoGatePasses)
      .where(and(...where))

    const out = { ...EMPTY_GATE_PASS_TEST_DRIVES }
    for (const row of rows) {
      if (!isTestDrivePurpose(row.purpose)) continue
      const outcome = testDriveOutcome(row.status)
      if (outcome === 'completed') out.completed += 1
      else if (outcome === 'cancelled') out.cancelled += 1
      else if (outcome === 'in_progress') out.inProgress += 1
      else continue // rejected / expired — neither a drive nor a customer cancellation.
      out.total += 1
    }
    return out
  } catch (error) {
    /*
     * ⚠️ Never take the Sales Report down for this. The card's DMS figure is the primary number and
     * must still render; a missing gate pass count is a missing sub-line, not a broken page.
     */
    console.error('[sales-report] gate pass test drives unavailable:', error)
    return EMPTY_GATE_PASS_TEST_DRIVES
  }
}
