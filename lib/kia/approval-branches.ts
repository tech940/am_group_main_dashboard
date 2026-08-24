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
