import 'server-only'

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { isGatePassApproverRole } from './access'

/**
 * Who actually gets the "a pass is waiting on you" email.
 *
 * ── Why this is resolved from the live user table, not hardcoded ──────────────────────────────
 * A role list answers "may this person approve". It does not answer "who, today, at this branch,
 * will see it" — and the gap between those two is how an approval queue ends up owned by nobody.
 * `finance_team` currently has SEVEN requests parked at its stage and NO active holder; two
 * `branch_admin` pins point at branches that do not exist. Nothing surfaces either, because the
 * role exists in the enum and the code is satisfied.
 *
 * So this resolves real, active, in-scope users and the caller is expected to react when the list
 * comes back empty rather than writing a row that no human will ever be shown.
 */

export type GatePassApprover = {
  id: string
  fullName: string
  email: string
  role: string
}

/** Tried in order. The first tier with a real holder at that branch wins the notification. */
const NOTIFY_TIERS = [
  ['sales_manager'],
  ['general_manager'],
  ['md'],
] as const

function dealerMatches(rawDealers: string | null, dealerCode: string): boolean {
  const pinned = String(rawDealers ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  // Unpinned means "covers everything", NOT "covers nothing". Fail-closed pinning is what left four
  // EAs unable to see any of 222 approval requests with money stalled behind them.
  if (pinned.length === 0) return true
  return pinned.includes(dealerCode.trim().toUpperCase())
}

/**
 * Everyone who MAY approve a pass at this dealer — the full set, for a "can this be actioned at
 * all" check.
 *
 * ⚠️ `developer` is deliberately filtered out here. It holds approve rights for support, but it is
 * not a business approver and must never be the reason a pass looks staffed when it is not.
 */
export async function listGatePassApprovers(dealerCode: string): Promise<GatePassApprover[]> {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      dealers: users.dealers,
    })
    .from(users)
    .where(eq(users.isActive, true))

  return rows
    .filter((r) => isGatePassApproverRole(r.role) && r.role !== 'developer')
    .filter((r) => dealerMatches(r.dealers, dealerCode))
    .map(({ dealers: _dealers, ...rest }) => rest)
}

/**
 * The people to actually email, narrowed to the most junior tier that has a real holder.
 *
 * Narrowing matters: mailing every approver at once trains the Sales Manager to ignore the mail
 * because "the GM will get it too", and trains the GM to ignore it because "that's the SM's job".
 * One named desk per pass, escalating only when that desk is genuinely empty.
 */
export async function resolveGatePassNotifyList(dealerCode: string): Promise<{
  recipients: GatePassApprover[]
  tier: string | null
  /** True when nobody at all can action a pass at this branch — the caller must surface this. */
  unstaffed: boolean
}> {
  const all = await listGatePassApprovers(dealerCode)
  for (const tier of NOTIFY_TIERS) {
    const match = all.filter((a) => (tier as readonly string[]).includes(a.role))
    if (match.length > 0) return { recipients: match, tier: tier[0], unstaffed: false }
  }
  return { recipients: [], tier: null, unstaffed: true }
}
