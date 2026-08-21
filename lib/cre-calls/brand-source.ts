import type { PreferredBrand } from '@/lib/customer-identity/phone-match'

/**
 * Which enquiry feed a CRE's calls should be matched against first.
 *
 * A number can exist in more than one brand's enquiry report — the same person shops KIA and
 * Hyundai — so when we resolve a name we have to choose which record to believe. The best available
 * signal is the CRE who made or took the call: a Hyundai-service CRE's calls are about Hyundai.
 *
 * ── Why this needs the special-team branch label, not just the brand ──────────────────────────
 * All seven special-team CREs sit on ONE branch whose brand string is "Special Team", so
 * `branchBrand.get(branchId)` collapses them together and cannot tell Platinum-service from
 * Kia-sales. `resolveSpecialTeamBranchLabel()` in ./directory.ts is the only thing that separates
 * them, and it returns a human label like "Special Branch (Kia sales)" — which is exactly the shape
 * this module parses. Feed BOTH values in and let the special label win when present.
 *
 * The mapping is substring-based rather than an exact table so that a renamed branch, a new outlet
 * or a new special-team member keeps working instead of silently falling back to "no preference".
 */

/**
 * Tested in order — the first hit wins, so anything ambiguous must be listed before the generic
 * brand it contains.
 *
 * ⚠️ "H Promise" is Hyundai's certified pre-owned programme, so it maps to the Hyundai feed. It is
 * listed BEFORE the bare hyundai test only for clarity; it would match either way. If that CRE
 * turns out to work Platinum stock instead, this is the one line to change.
 */
const BRAND_PATTERNS: Array<{ match: RegExp; brand: PreferredBrand }> = [
  { match: /platinum/i, brand: 'platinum' },
  { match: /\bkia\b/i, brand: 'kia' },
  { match: /h\s*promise/i, brand: 'hyundai' },
  { match: /hyundai/i, brand: 'hyundai' },
  // Tata has NO enquiry report in this database. Returning null (rather than guessing a brand) is
  // deliberate: the matcher then searches every feed in its default order, which is the honest
  // behaviour — we simply have no Tata enquiries to prefer.
  { match: /\btata\b/i, brand: null },
]

/**
 * Resolve the preferred enquiry brand from whatever the directory can tell us about a call.
 *
 * @param specialBranchLabel e.g. "Special Branch (Kia sales)" from resolveSpecialTeamBranchLabel()
 * @param branchBrand        e.g. "AM Kia" / "Hyundai" / "Special Team" from the branch directory
 * @param branchName         the display label, used only as a last resort
 *
 * Returns null when nothing names a brand, which is not a failure — it means "search everything".
 */
export function resolvePreferredBrand(
  specialBranchLabel?: string | null,
  branchBrand?: string | null,
  branchName?: string | null,
): PreferredBrand {
  // The special label is the most specific signal we have, and it is the ONLY one that can separate
  // the seven special-team CREs, so it is consulted first.
  for (const candidate of [specialBranchLabel, branchBrand, branchName]) {
    const text = String(candidate ?? '').trim()
    if (!text) continue
    // "Special Team" is a container, not a brand — skip it so we fall through to the next signal.
    if (/^special\s*team$/i.test(text)) continue
    for (const { match, brand } of BRAND_PATTERNS) {
      if (match.test(text)) return brand
    }
  }
  return null
}
