import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { hasAllBranchAccess, BRANCH_OPTIONS } from '@/lib/branches'
import {
  DEFAULT_VISIBLE_SECTIONS,
  PERMISSION_GROUPS,
  RESTRICTED_DEFAULT_SECTIONS,
  ROLE_PERMISSION_TEMPLATES,
  SECTION_ROUTES,
  type PermissionRole,
} from '@/lib/permissions/registry'

/**
 * Answers ONE question, for one user, on one screen: **why can or can't they see this section?**
 *
 * ⚠️ This exists because "granted in the Access Map but the sidebar doesn't show it" has now been a
 * live incident four separate times, and every occurrence cost real investigation. The answer is
 * always somewhere in the interaction between an explicit override, a role template, a tier
 * default, a brand constraint, and a deny-by-default section — but nothing surfaced that reasoning,
 * so each time it had to be re-derived by reading code and querying the database by hand.
 *
 * The resolution ORDER encoded in `classify()` mirrors lib/permissions/service.ts. If that resolver
 * changes, this must change with it — it is a lens on the real snapshot, not a second implementation
 * of it. `effective` always comes from the real resolver; only the EXPLANATION is derived here.
 */

export type AccessReason =
  | 'super_admin'
  | 'explicit_grant'
  | 'explicit_deny'
  | 'role_template'
  | 'global_access_role'
  | 'default_visible'
  | 'restricted_default'
  | 'other_brand'
  | 'not_in_template'

export type SectionAccess = {
  sectionKey: string
  sectionName: string
  /**
   * Brand this section belongs to, as a display label. Load-bearing, not decoration: the registry
   * names four separate sections "Business Excellence" (one per brand) and three "Complaints", so
   * without the brand the table shows repeated identical rows and the reader cannot tell which one
   * they are looking at.
   */
  brandLabel: string | null
  href: string | null
  /** What the REAL resolver says. Never inferred. */
  visible: boolean
  reason: AccessReason
  explanation: string
  /** True when an admin ticked this user's box explicitly. */
  hasOverride: boolean
  overrideValue: boolean | null
  /** True when the role's own template carries the key. */
  inRoleTemplate: boolean
  /** Deny-by-default section — a role template alone will not open it. */
  restrictedByDefault: boolean
  /** Section belongs to a brand the user is not assigned to. */
  brandMismatch: boolean
}

export type EffectiveAccessReport = {
  user: { id: string; email: string; fullName: string | null; role: string; brand: string | null; isActive: boolean }
  isSuperAdmin: boolean
  hasGlobalAccess: boolean
  sections: SectionAccess[]
  summary: { visible: number; hidden: number; explicitGrants: number; explicitDenies: number; inertGrants: number }
}

const BRAND_PREFIXES = BRANCH_OPTIONS.map((b) => b.value) as string[]

function sectionBrand(sectionKey: string): string | null {
  const prefix = BRAND_PREFIXES.find((b) => sectionKey === b || sectionKey.startsWith(`${b}.`))
  return prefix ?? null
}

function userBrands(brand: string | null | undefined): string[] {
  if (hasAllBranchAccess(brand)) return BRAND_PREFIXES
  if (!brand) return []
  // A user's brand may be a comma-separated multi-brand assignment ('hyundai,tata').
  return brand.split(',').map((v) => v.trim()).filter((v) => BRAND_PREFIXES.includes(v))
}

function classify(args: {
  visible: boolean
  role: PermissionRole
  overrideValue: boolean | null
  inRoleTemplate: boolean
  restricted: boolean
  brandMismatch: boolean
  defaultVisible: boolean
}): { reason: AccessReason; explanation: string } {
  const { visible, role, overrideValue, inRoleTemplate, restricted, brandMismatch, defaultVisible } = args

  if (isSuperAdminRole(role)) {
    return { reason: 'super_admin', explanation: 'Super admin — sees every section regardless of grants.' }
  }
  if (overrideValue === false) {
    return { reason: 'explicit_deny', explanation: 'An admin explicitly DENIED this user. A deny always wins, even over the role template.' }
  }
  if (!visible && brandMismatch) {
    return { reason: 'other_brand', explanation: 'Belongs to a brand this user is not assigned to, so the grant is stripped when the snapshot is narrowed to their brand.' }
  }
  if (!visible && overrideValue === true) {
    return {
      reason: 'restricted_default',
      explanation: restricted
        ? 'Explicitly granted, but this is a deny-by-default section that this role cannot hold — the grant is INERT.'
        : 'Explicitly granted, but the resolver still withholds it. Check the brand assignment and the tier profile.',
    }
  }
  if (overrideValue === true) {
    return { reason: 'explicit_grant', explanation: 'Granted to this user directly in the Access Map.' }
  }
  if (visible && inRoleTemplate) {
    return { reason: 'role_template', explanation: `Comes from the ${role} role template — not a per-user grant.` }
  }
  if (visible && hasGlobalAccessRole(role)) {
    return { reason: 'global_access_role', explanation: 'This role has group-wide access, so non-restricted sections are open by default.' }
  }
  if (visible && defaultVisible) {
    return { reason: 'default_visible', explanation: 'Visible to everyone by default.' }
  }
  if (restricted) {
    return { reason: 'restricted_default', explanation: 'Deny-by-default section. Needs an explicit grant in the Access Map — a role template will not open it.' }
  }
  return { reason: 'not_in_template', explanation: `Not in the ${role} role template and not granted to this user.` }
}

export async function getEffectiveAccessReport(userId: string): Promise<EffectiveAccessReport | null> {
  const [target] = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, brand: users.brand, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
  if (!target) return null

  const snapshot = await getUserPermissionSnapshot(target.id)
  const role = target.role as PermissionRole
  const template = new Set(ROLE_PERMISSION_TEMPLATES[role] ?? [])
  const assigned = userBrands(target.brand)

  const sections: SectionAccess[] = PERMISSION_GROUPS
    // Only leaf sections carry a `view` action; parent groups are headings.
    .filter((group) => group.actions.includes('view'))
    .map((group) => {
      const viewKey = `${group.key}.view`
      const brand = sectionBrand(group.key)
      const brandMismatch = Boolean(
        brand && assigned.length > 0 && !assigned.includes(brand) && !isSuperAdminRole(role) && !hasGlobalAccessRole(role),
      )
      const overrideValue = Object.hasOwn(snapshot.overrides, viewKey) ? Boolean(snapshot.overrides[viewKey]) : null
      const inRoleTemplate = template.has(viewKey)
      const restricted = RESTRICTED_DEFAULT_SECTIONS.has(group.key)
      const visible = snapshot.effective[viewKey] === true

      const { reason, explanation } = classify({
        visible, role, overrideValue, inRoleTemplate, restricted, brandMismatch,
        defaultVisible: DEFAULT_VISIBLE_SECTIONS.has(group.key),
      })

      return {
        sectionKey: group.key,
        sectionName: group.name,
        brandLabel: brand ? (BRANCH_OPTIONS.find((b) => b.value === brand)?.label ?? brand) : null,
        href: SECTION_ROUTES[group.key]?.href ?? null,
        visible, reason, explanation,
        hasOverride: overrideValue !== null,
        overrideValue,
        inRoleTemplate,
        restrictedByDefault: restricted,
        brandMismatch,
      }
    })
    // Group by brand first so the four "Business Excellence" rows sit under their own brands
    // instead of stacking up together looking like duplicates.
    .sort((a, b) =>
      (a.brandLabel ?? '').localeCompare(b.brandLabel ?? '')
      || a.sectionName.localeCompare(b.sectionName))

  return {
    user: {
      id: target.id, email: target.email, fullName: target.fullName,
      role: String(target.role), brand: target.brand ?? null, isActive: Boolean(target.isActive),
    },
    isSuperAdmin: isSuperAdminRole(role),
    hasGlobalAccess: hasGlobalAccessRole(role),
    sections,
    summary: {
      visible: sections.filter((s) => s.visible).length,
      hidden: sections.filter((s) => !s.visible).length,
      explicitGrants: sections.filter((s) => s.overrideValue === true).length,
      explicitDenies: sections.filter((s) => s.overrideValue === false).length,
      // The headline number: boxes ticked in the Access Map that buy the user NOTHING.
      inertGrants: sections.filter((s) => s.overrideValue === true && !s.visible).length,
    },
  }
}
