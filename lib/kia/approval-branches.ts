/**
 * Branches that submit payment approvals but have NO DMS dealer code.
 *
 * ── Why this is separate from KIA_BRANCH_DEALERS ──────────────────────────────────────────────
 * BANIHAL is a real KIA outlet. The approvals form offers it as a location and 7 requests worth
 * ~Rs12.5L are filed against dealer_code 'JK502' — but it is absent from KIA_BRANCH_DEALERS, so
 * parseUserDealers silently dropped 'JK502' from any pin and NO administrator could grant access to
 * those rows. They were visible only to all-branch users; Banihal's own staff could not see their
 * own requests.
 *
 * Adding it to KIA_BRANCH_DEALERS was the wrong lever — that registry drives the sales, stock and
 * Business Excellence dealer pickers, where Banihal has no DMS data and would show as a permanently
 * empty branch. Petty Cash hit the identical problem and solved it the same way
 * (`extraLocations: ['Banihal']`, lib/petty-cash/constants.ts).
 *
 * ⚠️ Safe to grant: getUserDealerScope (lib/auth/dealer-scope.ts) returns DEALER_SCOPE_NONE for a
 * pin that resolves to no registered dealer, so a Banihal pin FAILS CLOSED in sales/BE rather than
 * widening anything. It only opens what lib/kia/approval-scope.ts explicitly honours.
 *
 * Client-safe: pure data, no server-only imports, so the admin console can render these as options.
 */

export type ApprovalOnlyBranch = {
  /** Stored in users.dealers and matched against kia_approval_requests.dealer_code. */
  code: string
  label: string
  /** Alternative token the row may carry in `location` instead of a dealer code. */
  aliases: readonly string[]
}

export const APPROVAL_ONLY_BRANCHES: Record<string, readonly ApprovalOnlyBranch[]> = {
  kia: [{ code: 'JK502', label: 'Banihal', aliases: ['BANIHAL'] }],
}

/** Approval-only branches for a brand, or [] when it has none. */
export function getApprovalOnlyBranches(brand: string): readonly ApprovalOnlyBranch[] {
  return APPROVAL_ONLY_BRANCHES[String(brand || '').trim().toLowerCase()] || []
}

/** Every token (code + aliases) that a pin on this branch should open, upper-cased. */
export function approvalBranchTokens(brand: string): string[] {
  return getApprovalOnlyBranches(brand)
    .flatMap((b) => [b.code, ...b.aliases])
    .map((t) => t.toUpperCase())
}

/**
 * One branch, several names — the reason a correctly-pinned Accounts user saw nothing.
 *
 * ── The bug ───────────────────────────────────────────────────────────────────────────────────
 * The approvals form and the DMS registry disagree about what to call a branch, and the pin only
 * ever matched one spelling. Measured across all 153 live requests:
 *
 *     KIA Jammu     JK402 (106 requests)  ·  KIA-JM (14)  ·  location JAMMU
 *     KIA Udhampur  JK501 (12)            ·  KIA-UD (1)   ·  location UDHAMPUR
 *     KIA Banihal   JK502 (8)             ·  location BANIHAL
 *     Platinum      N5211 (3)             ·  location JAMMU
 *
 * KIA Accounts is pinned to `JK402,JK501`, which resolved to exactly {JK402, JK501}. The 15
 * requests filed as KIA-JM or KIA-UD matched neither the code nor the location, so they were
 * invisible to the very role that had to action them — including a Rs2,47,605 accessories bill
 * sitting fully approved and waiting on Accounts. The rows were not lost and no permission was
 * wrong; the branch was simply spelled differently on the row than in the pin.
 *
 * ⚠️ This WIDENS nothing. Every group below names ONE physical branch, so admitting its other
 * spellings grants no access the pin did not already intend. It is applied AFTER the brand gate in
 * isApprovalVisibleTo, which matters because JAMMU is a location under KIA, Platinum and Hyundai
 * alike — the groups are per-brand and never cross.
 *
 * ⚠️ Add a spelling here the moment a feed or form introduces one. The failure is silent: the row
 * simply never appears for the branch's own staff, and nobody can tell the difference between
 * "no requests" and "cannot see the requests".
 */
export const APPROVAL_BRANCH_SYNONYMS: Record<string, readonly (readonly string[])[]> = {
  kia: [
    ['JK402', 'KIA-JM', 'JAMMU'],
    ['JK501', 'KIA-UD', 'UDHAMPUR'],
    ['JK502', 'BANIHAL'],
  ],
  // Hyundai files the branch NAME as the dealer code; the N-codes are what the DMS registry pins.
  hyundai: [
    ['N5216', 'N5203', 'JAMMU'],
    ['N6845', 'KATHUA'],
    ['N6848', 'BILLAWAR'],
    ['N6847', 'VIJAYPUR'],
    ['N6844', 'AKHNOOR'],
    ['N6846', 'RS PURA', 'RSPURA'],
  ],
  platinum: [
    ['N5211', 'JAMMU'],
    ['N6828', 'POONCH'],
    ['N6250', 'RAJOURI'],
  ],
}

/**
 * Expand a set of branch tokens to include every other spelling of the same branches.
 *
 * @param brand  the ROW's brand — groups never cross brands
 * @param tokens already-upper-cased tokens the user is pinned to
 */
export function expandBranchSynonyms(brand: string, tokens: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const t of tokens) out.add(String(t).trim().toUpperCase())
  const groups = APPROVAL_BRANCH_SYNONYMS[String(brand || '').trim().toLowerCase()] || []
  for (const group of groups) {
    // A pin on ANY member opens the whole group — they are one branch under different names.
    if (group.some((member) => out.has(member.toUpperCase()))) {
      for (const member of group) out.add(member.toUpperCase())
    }
  }
  return out
}
