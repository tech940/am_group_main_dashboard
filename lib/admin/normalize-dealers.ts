import { parseUserDealers } from '@/lib/dealers/registry'
import { approvalBranchTokens } from '@/lib/kia/approval-branches'

/**
 * What the Edit User dialog's "Branch scope" checkboxes actually get stored as.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────────────────────────
 * `parseUserDealers` filters a pin against the brand's DMS dealer registry, and some branches that
 * really do submit payment approvals are absent from it. Banihal (JK502) is the live example — it
 * is the entire reason lib/kia/approval-branches.ts exists.
 *
 * So the dialog offered a "Banihal — approvals only (JK502)" checkbox that the save path then threw
 * away without a word: ticking it stored `JK402,JK501`, and the box came back unchecked on every
 * save. Ticking Banihal ALONE was worse — the pin normalized to NULL, and an empty pin means the
 * user sees nothing at all in Approvals, which fails closed by design.
 *
 * An admin cannot fix a scoping problem with a control that silently discards their input.
 *
 * ⚠️ Registry-backed codes still go through parseUserDealers unchanged. The approvals-only tokens
 * are admitted ALONGSIDE them, and only when actually ticked. This is safe outside approvals:
 * getUserDealerScope returns DEALER_SCOPE_NONE for a pin resolving to no registered dealer, so a
 * Banihal pin fails closed in sales/BE rather than widening anything there.
 *
 * ⚠️ Dealer scope only applies to a single concrete brand that HAS a dealer registry. No brand,
 * 'all', or multi-brand clears it to null (= all branches). That is why every multi-brand user —
 * the EAs among them — carries `dealers = NULL` and can never be pinned.
 *
 * Extracted from app/api/admin/users/route.ts so the rule has one home and can be tested; it was
 * inline there, which is how it drifted from the dialog that feeds it.
 */
export function normalizeDealers(brand: string | null | undefined, value: unknown): string | null {
  if (!brand || brand === 'all' || brand.includes(',')) return null

  const codes = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' ? value.split(',') : []

  const valid = parseUserDealers(brand, codes.join(','))

  const approvalsOnly = new Set(approvalBranchTokens(brand))
  const ticked = codes.map((c) => c.trim().toUpperCase()).filter((c) => approvalsOnly.has(c))

  const merged = [...new Set([...valid, ...ticked])]
  return merged.length ? merged.join(',') : null
}
