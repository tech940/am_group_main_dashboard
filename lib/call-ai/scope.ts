/**
 * Which recordings AI Call Review reads. Owner, 2026-09-18: "AM Hyundai calls only for now, not all branches".
 *
 * A call belongs to a team by the SAME rule the Recordings tab uses to label it:
 *   1. a special-team CRE is identified by name/id (resolveSpecialTeamBranchLabel) — all seven sit on ONE
 *      "Special Team" branch, so their branch says nothing about which brand they work;
 *   2. everyone else: the row's branch_id, else the CRE's profile branch (resolveBranchId) — branch_id is
 *      NULL on a large share of rows, and dropping those would silently lose most of Hyundai's calls.
 *
 * ⚠️ Do NOT reuse resolvePreferredBrand (lib/cre-calls/brand-source.ts) here. It maps the "H Promise" desk to
 * Hyundai because Hyundai Promise is the name of Hyundai's used-car programme — right for picking which
 * enquiry feed to search, wrong for this scope, which the owner set to exclude that desk.
 */
import {
  branchLabel,
  brandSlug,
  resolveBranchId,
  resolveSpecialTeamBranchLabel,
  type CreDirectory,
} from '@/lib/cre-calls/directory'

type ScopeRule = { label: string; brandSlugs: string[]; specialLabels: string[] }

/** Widening later is a config change (CALL_AI_SCOPE=hyundai,kia) plus a backfill — no code. */
export const SCOPE_RULES: Record<string, ScopeRule> = {
  hyundai: { label: 'AM Hyundai', brandSlugs: ['hyundai'], specialLabels: ['Special Branch (Hyundai service)'] },
  kia: { label: 'AM Kia', brandSlugs: ['kia'], specialLabels: ['Special Branch (Kia sales)', 'Special Branch (Kia service)', 'Special Branch (Kia Udhampur)'] },
  honda: { label: 'AM Honda', brandSlugs: ['honda'], specialLabels: [] },
  ktm: { label: 'KTM', brandSlugs: ['ktm'], specialLabels: [] },
  platinum: { label: 'AM Platinum', brandSlugs: [], specialLabels: ['Special Branch (Platinum service)'] },
  tata: { label: 'AM Tata', brandSlugs: [], specialLabels: ['Special Branch (Tata sales)'] },
  h_promise: { label: 'H Promise desk', brandSlugs: [], specialLabels: ['Special Branch (H Promise)'] },
}

export function scopeLabel(keys: string[]): string {
  return keys.map((key) => SCOPE_RULES[key]?.label ?? key).join(' + ')
}

export type ScopeRow = { branch_id?: string | null; cre_id?: string | null }

export type ScopeResult =
  | { inScope: true; scope: string; branchId: string | null; team: string; creName: string | null }
  | { inScope: false }

export function classifyScope(row: ScopeRow, dir: CreDirectory, scopes: string[]): ScopeResult {
  const creName = row.cre_id ? dir.profileName.get(row.cre_id) ?? null : null
  const special = resolveSpecialTeamBranchLabel(row.cre_id, creName)
  const branchId = resolveBranchId(row, dir)

  for (const key of scopes) {
    const rule = SCOPE_RULES[key]
    if (!rule) continue
    if (special) {
      if (rule.specialLabels.some((label) => label.toLowerCase() === special.toLowerCase())) {
        return { inScope: true, scope: key, branchId, team: special, creName }
      }
      continue
    }
    const brand = branchId ? dir.branchBrand.get(branchId) : null
    if (brand && rule.brandSlugs.includes(brandSlug(brand))) {
      return { inScope: true, scope: key, branchId, team: branchLabel(branchId, dir, row.cre_id, creName), creName }
    }
  }
  return { inScope: false }
}
