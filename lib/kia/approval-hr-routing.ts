/**
 * Does a vendor-payment request need HR sign-off before it reaches the MD?
 *
 * THE SINGLE DEFINITION. Previously this rule existed as three byte-identical hand-copies in
 * `app/api/brands/kia/approvals/[id]/action/route.ts`, `.../bulk-action/route.ts` and
 * `features/kia/kia-approvals-page.tsx`. All three now import from here so the server, the bulk
 * endpoint and the UI can never disagree about whether HR is in the chain.
 *
 * Deliberately free of `server-only` — the client page imports it too.
 *
 * ⚠️ WHY THIS CHANGED (2026-08-02). The original rule did an EXACT match against a list of singular
 * lowercase words: `['salary', 'pf', 'incentive', 'training expense', ..., 'uniform', 'esi']`. Real
 * `approval_type` values are phrases, so it matched NOTHING — measured on the live table, 0 of 52
 * requests routed through HR, and 8 payments worth Rs 64,034 skipped HR entirely:
 *
 *     "Salary Disbursement"      (1)  — rule wanted exactly "salary"
 *     "Incentive Disbursement"   (3)  — rule wanted exactly "incentive"
 *     "Training Expenses"        (4)  — rule wanted exactly "training expense" (singular)
 *
 * Two of those were already approved all the way through MD and Accounts with no HR review. The HR
 * stage was, in practice, dead code.
 *
 * The fix matches on a WHOLE WORD anywhere in the type, so any phrasing of a payroll payment is
 * caught. Word boundaries matter: a bare substring test would make `pf` match inside unrelated
 * words. Verified against every approval_type present in the live table — the twelve non-payroll
 * types ("Stock Transfer", "Fund Transfer", "Vendor Payment", "Travelling Charges", "Local Vendor",
 * "Purchase", "Maintenance", "Promotion", "Others", …) all still return false.
 */

/**
 * Payroll/people-cost keywords. Matched as whole words, case-insensitively, anywhere in the type.
 * `training` covers "Training Expense", "Training Expenses" and "Training_Expense" alike.
 */
export const HR_APPROVAL_KEYWORDS = [
  'salary',
  'salaries',
  'pf',
  'epf',
  'esi',
  'esic',
  'incentive',
  'incentives',
  'uniform',
  'uniforms',
  'training',
  'bonus',
  'gratuity',
] as const

/**
 * `\b` around each keyword so "pf" cannot match inside another word, and `_` is treated as a
 * separator too (Postgres data contains "training_expense" style values in some feeds).
 */
const HR_PATTERN = new RegExp(
  `(?:^|[^a-z0-9])(${HR_APPROVAL_KEYWORDS.join('|')})(?:[^a-z0-9]|$)`,
  'i',
)

/**
 * Brands that HAVE an HR approval stage at all.
 *
 * ⚠️ HR IS KIA-ONLY. Outside KIA a payroll-flavoured request goes straight from the first stage to
 * the EA — there is no HR desk in that chain. Before this, the rule was brand-blind, so a Hyundai or
 * Platinum "Incentive Disbursement" was routed to an HR stage those brands do not staff: measured,
 * PLATINUM_0004 (Rs2,54,397) had cleared its first stage and was sitting on an HR desk that nobody
 * was ever going to clear.
 *
 * ⚠️ Deliberately its OWN list rather than reusing ED_BRANDS from lib/approvals/first-stage-approver.
 * Both happen to be ['kia'] today, and that is a coincidence of the org chart, not one rule. Sharing
 * the constant would mean that giving some other brand an ED silently gave it an HR stage too.
 */
export const HR_STAGE_BRANDS = ['kia'] as const

/** Does this brand have an HR approval stage in its chain? */
export function brandHasHrStage(brand: unknown): boolean {
  const b = String(brand ?? '').trim().toLowerCase()
  // Rows written before the `brand` column existed are KIA — the same fallback approval-scope uses.
  if (!b) return true
  return (HR_STAGE_BRANDS as readonly string[]).some((known) => b === known || b.startsWith(known))
}

/**
 * ⚠️ `brand` is REQUIRED, and that is on purpose. Making it optional would let a caller keep the old
 * brand-blind behaviour by simply not passing it — and the last three times a rule in this section
 * changed, the bug was that only one of the call sites got updated. A required parameter makes tsc
 * name every one of them.
 */
export function isHrApprovalRequired(
  approvalType: string | null | undefined,
  brand: string | null | undefined,
): boolean {
  if (!brandHasHrStage(brand)) return false
  if (!approvalType) return false
  const normalized = approvalType.trim().toLowerCase().replace(/_/g, ' ')
  if (!normalized) return false
  return HR_PATTERN.test(normalized)
}
