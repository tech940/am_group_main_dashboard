import 'server-only'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permissionAuditLogs, permissionGroups, permissions, rolePermissions, userPermissions, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { BRANCH_OPTIONS, hasAllBranchAccess } from '@/lib/branches'
import { getCachedData, invalidateCache } from '@/lib/redis/cache-utils'
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  RESTRICTED_DEFAULT_PERMISSION_KEYS,
  SENSITIVE_REPORT_PERMISSION_KEYS,
  ROLE_PERMISSION_TEMPLATES,
  type PermissionRole,
} from '@/lib/permissions/registry'
import { getRoleProfile, tierBundleKeys } from '@/lib/permissions/tiers'

export type PermissionSnapshot = {
  effective: Record<string, boolean>
  roleDefaults: Record<string, boolean>
  overrides: Record<string, boolean>
}

export type PermissionDeniedResult = {
  allowed: false
  reason: string
}

export type PermissionAllowedResult = {
  allowed: true
}

export type PermissionCheckResult = PermissionAllowedResult | PermissionDeniedResult

// Bumped to v12 for the crm/idt roles — cached snapshots are keyed on this, so without a bump an
// existing session would carry stale permissions for up to the cache TTL.
const PERMISSION_CACHE_VERSION = 'v12'
const PERMISSION_CACHE_TTL_SECONDS = 75 * 60

// Tiered ("pyramid") access resolver — now the DEFAULT (Phase-4 cutover). The runtime snapshot is
// built from the inherited TIER bundle (lib/permissions/tiers.ts) UNIONED with the role's DB defaults,
// so V2 effective is a provable SUPERSET of the old flat model (nobody loses access; see
// scripts/verify-snapshot-parity.ts → 0 losses). Instant rollback: set PERMISSIONS_RESOLVER=v1 to
// fall back to the legacy per-role-template resolver (kept intact for exactly this reason).
const USE_TIERED_RESOLVER = process.env.PERMISSIONS_RESOLVER !== 'v1'
const ADMIN_ONLY_PERMISSION_GROUPS = new Set(['user_management', 'access_control', 'admin_audit'])

function isAdminOnlyPermission(permissionKey: string) {
  const permission = PERMISSIONS.find((item) => item.key === permissionKey)
  return Boolean(permission && ADMIN_ONLY_PERMISSION_GROUPS.has(permission.groupKey))
}

// Sections that are deny-by-default: excluded from EVERY blanket default (brand + global-access) so
// only super admins (MD/Developer) and explicitly-granted users/roles see them. New sidebar sections
// land here automatically (see RESTRICTED_DEFAULT_SECTIONS in the registry).
function isRestrictedDefaultPermission(permissionKey: string) {
  return RESTRICTED_DEFAULT_PERMISSION_KEYS.has(permissionKey)
}

export function isMissingPermissionTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('permission_groups')
    || message.includes('permissions')
    || message.includes('role_permissions')
    || message.includes('user_permissions')
    || message.includes('permission_audit_logs')
    || message.includes('relation "permission_')
    || message.includes("relation 'permission_")
}

const BRANCH_PERMISSION_PREFIXES = BRANCH_OPTIONS.map((branch) => branch.value)

function getBranchPermissionPrefixes(branchAccess: string | null | undefined) {
  if (hasAllBranchAccess(branchAccess)) return BRANCH_PERMISSION_PREFIXES
  if (!branchAccess) return []
  // A user's brand may be a single value ('kia') OR a comma-separated multi-brand assignment
  // ('hyundai,tata'). Split it and keep every valid brand — otherwise multi-brand users match
  // NO prefix, so constrainSnapshotToBranch/applyBrandDefault would grant them nothing at all.
  return branchAccess
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is typeof BRANCH_PERMISSION_PREFIXES[number] =>
      (BRANCH_PERMISSION_PREFIXES as string[]).includes(value))
}

function applyBranchRoleDefaults(
  roleDefaults: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined
) {
  const prefixes = getBranchPermissionPrefixes(branchAccess)
  if (prefixes.length === 0) return
  const availableKeys = new Set(PERMISSIONS.map((permission) => permission.key))

  if (role === 'manager' || role === 'technician' || role === 'viewer') {
    const kiaTemplateKeys = ROLE_PERMISSION_TEMPLATES[role].filter((key) =>
      key === 'kia.view' || key.startsWith('kia.')
    )
    for (const prefix of prefixes) {
      for (const key of kiaTemplateKeys) {
        const mappedKey = `${prefix}${key.slice('kia'.length)}`
        if (availableKeys.has(mappedKey)) roleDefaults[mappedKey] = true
      }
    }
  }
}

function constrainSnapshotToBranch(
  values: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined
) {
  if (isSuperAdminRole(role) || hasGlobalAccessRole(role) || hasAllBranchAccess(branchAccess)) return
  const prefixes = getBranchPermissionPrefixes(branchAccess)

  for (const permission of PERMISSIONS) {
    const belongsToKnownBranch = BRANCH_PERMISSION_PREFIXES.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!belongsToKnownBranch) continue
    const isAssignedBranch = prefixes.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!isAssignedBranch) values[permission.key] = false
  }
}

// Roles whose access is defined purely by their role template — they do NOT receive the
// blanket "see your whole brand" default. This moves two former sidebar hardcodes into the
// resolution layer: branch_admin (Petty Cash only) and sales_executive (Bookings only).
const TEMPLATE_ONLY_ROLES = new Set<PermissionRole>(['branch_admin', 'sales_executive', 'call_agent', 'ca', 'crm', 'idt'])

// Sensitive analytics (Sales Report, Stock Report) are visible by default ONLY to top management:
// super admins (MD/Developer) and EBA. Every other role — including CEO/EA and all brand roles — is
// denied by default and must be granted explicitly in the Access Map. Applied to the DEFAULT layer
// (after the brand/global blanket grants) so an explicit Allow override still wins.
const SENSITIVE_REPORT_DEFAULT_ROLES = new Set<PermissionRole>(['developer', 'md', 'eba'])

function applySensitiveReportDefaults(values: Record<string, boolean>, role: PermissionRole) {
  if (isSuperAdminRole(role) || SENSITIVE_REPORT_DEFAULT_ROLES.has(role)) return
  for (const key of SENSITIVE_REPORT_PERMISSION_KEYS) {
    if (key in values) values[key] = false
  }
}


// A user's brand grants default visibility of that brand's own sections. This is applied to
// the DEFAULT layer (before overrides) so an explicit Deny wins. Template-only roles and the
// sensitive report sections are excluded so their narrower rules hold.
function applyBrandDefault(
  values: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined
) {
  if (isSuperAdminRole(role) || hasGlobalAccessRole(role) || hasAllBranchAccess(branchAccess)) return
  if (TEMPLATE_ONLY_ROLES.has(role)) return
  // Grant every section of EACH assigned brand (handles comma-separated multi-brand users).
  const prefixes = getBranchPermissionPrefixes(branchAccess)
  if (!prefixes.length) return
  for (const key of Object.keys(values)) {
    if (!prefixes.some((prefix) => key.startsWith(`${prefix}.`))) continue
    if (isRestrictedDefaultPermission(key)) continue // deny-by-default sections (e.g. new sidebar sections)
    values[key] = true
  }
}

function buildRoleTemplateSnapshot(role: PermissionRole, branchAccess?: string | null): PermissionSnapshot {
  const roleKeys = new Set(
    isSuperAdminRole(role)
      ? PERMISSIONS.map((permission) => permission.key)
      : hasGlobalAccessRole(role)
        ? PERMISSIONS.filter((permission) => !ADMIN_ONLY_PERMISSION_GROUPS.has(permission.groupKey)).map((permission) => permission.key)
      : (ROLE_PERMISSION_TEMPLATES[role] || [])
  )
  const roleDefaults = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, roleKeys.has(permission.key)]))
  applyBranchRoleDefaults(roleDefaults, role, branchAccess)
  constrainSnapshotToBranch(roleDefaults, role, branchAccess)
  if (isSuperAdminRole(role)) {
    for (const key of Object.keys(roleDefaults)) roleDefaults[key] = true
  } else if (hasGlobalAccessRole(role)) {
    for (const key of Object.keys(roleDefaults)) roleDefaults[key] = !isAdminOnlyPermission(key) && !isRestrictedDefaultPermission(key)
  } else {
    const prefixes = getBranchPermissionPrefixes(branchAccess)
    for (const key of Object.keys(roleDefaults)) {
      if (isRestrictedDefaultPermission(key)) continue // deny-by-default sections
      if (prefixes.some((prefix) => key.startsWith(`${prefix}.`))) roleDefaults[key] = true
    }
  }
  applySensitiveReportDefaults(roleDefaults, role)

  return {
    effective: { ...roleDefaults },
    roleDefaults,
    overrides: {},
  }
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${PERMISSION_CACHE_VERSION}:user:${userId}`
}

export async function clearUserPermissionCache(userId: string) {
  await invalidateCache(getPermissionCacheKey(userId))
}

// The permission registry (groups / permissions / role-template seeds) is defined in CODE and
// only changes on deploy — yet its ~dozens of idempotent upserts used to run on EVERY permission
// read, snapshot build, catalog fetch and per-user Save. Against a ~225ms pooler RTT that was the
// dominant cost behind the slow Access Map (load + save) and guarded pages. Throttle it to once
// per process window and de-dupe concurrent callers, so the sync happens right after a deploy and
// then effectively for free until the window lapses.
let registrySyncPromise: Promise<void> | null = null
let registrySyncedUntil = 0
const REGISTRY_SYNC_TTL_MS = 10 * 60 * 1000

export async function ensurePermissionRegistrySynced(): Promise<void> {
  if (Date.now() < registrySyncedUntil) return
  if (registrySyncPromise) return registrySyncPromise
  registrySyncPromise = (async () => {
    await syncPermissionRegistry()
    registrySyncedUntil = Date.now() + REGISTRY_SYNC_TTL_MS
  })().finally(() => { registrySyncPromise = null })
  return registrySyncPromise
}

async function syncPermissionRegistry() {
  const now = new Date()

  if (PERMISSION_GROUPS.length > 0) {
    await db.insert(permissionGroups)
      .values(PERMISSION_GROUPS.map((group) => ({
        key: group.key,
        name: group.name,
        parentKey: group.parentKey,
        description: group.description,
        sortOrder: group.sortOrder,
        isActive: true,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: permissionGroups.key,
        set: {
          name: sql`excluded.name`,
          parentKey: sql`excluded.parent_key`,
          description: sql`excluded.description`,
          sortOrder: sql`excluded.sort_order`,
          isActive: true,
          updatedAt: now,
        },
      })
  }

  if (PERMISSIONS.length > 0) {
    await db.insert(permissions)
      .values(PERMISSIONS.map((permission) => ({
        name: permission.key,
        groupKey: permission.groupKey,
        label: permission.label,
        description: permission.description,
        resource: permission.resource,
        action: permission.action,
        sortOrder: permission.sortOrder,
        isActive: true,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: permissions.name,
        set: {
          groupKey: sql`excluded.group_key`,
          label: sql`excluded.label`,
          description: sql`excluded.description`,
          resource: sql`excluded.resource`,
          action: sql`excluded.action`,
          sortOrder: sql`excluded.sort_order`,
          isActive: true,
          updatedAt: now,
        },
      })
  }

  const permissionRows = await db.select({ id: permissions.id, name: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, PERMISSIONS.map((permission) => permission.key)))

  const permissionIdByName = new Map(permissionRows.map((permission) => [permission.name, permission.id]))

  const rolePermissionRows = Object.entries(ROLE_PERMISSION_TEMPLATES)
    .flatMap(([role, permissionKeys]) => permissionKeys
      .map((permissionKey) => {
        const permissionId = permissionIdByName.get(permissionKey)
        return permissionId
          ? { role: role as PermissionRole, permissionId, allowed: true, updatedAt: now }
          : null
      })
      .filter((value): value is { role: PermissionRole; permissionId: string; allowed: boolean; updatedAt: Date } => Boolean(value)))

  if (rolePermissionRows.length > 0) {
    // SEED ONLY — insert-if-absent. Role defaults are editable in the Admin → Roles tab, so we
    // must NOT overwrite an existing role_permissions row on every sync (that would clobber
    // admin edits). New template keys are still seeded; existing rows are left as the DB has
    // them. Trade-off: removing a key from a code template no longer un-grants it — the DB is
    // authoritative for role defaults once seeded.
    await db.insert(rolePermissions)
      .values(rolePermissionRows)
      .onConflictDoNothing({
        target: [rolePermissions.role, rolePermissions.permissionId],
      })
  }
}

export async function getPermissionCatalog() {
  try {
    await ensurePermissionRegistrySynced()
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return {
        groups: PERMISSION_GROUPS.map((group) => ({
          id: group.key,
          key: group.key,
          name: group.name,
          parentKey: group.parentKey,
          description: group.description,
          sortOrder: group.sortOrder,
          isActive: true,
        })),
        permissions: PERMISSIONS.map((permission) => ({
          id: permission.key,
          key: permission.key,
          groupKey: permission.groupKey,
          label: permission.label,
          description: permission.description,
          resource: permission.resource,
          action: permission.action,
          sortOrder: permission.sortOrder,
          isActive: true,
        })),
        setupRequired: true,
      }
    }
    throw error
  }

  const [groupRows, permissionRows] = await Promise.all([
    db.select({
      id: permissionGroups.id,
      key: permissionGroups.key,
      name: permissionGroups.name,
      parentKey: permissionGroups.parentKey,
      description: permissionGroups.description,
      sortOrder: permissionGroups.sortOrder,
      isActive: permissionGroups.isActive,
    })
      .from(permissionGroups)
      .where(eq(permissionGroups.isActive, true))
      .orderBy(permissionGroups.sortOrder, permissionGroups.name),
    db.select({
      id: permissions.id,
      key: permissions.name,
      groupKey: permissions.groupKey,
      label: permissions.label,
      description: permissions.description,
      resource: permissions.resource,
      action: permissions.action,
      sortOrder: permissions.sortOrder,
      isActive: permissions.isActive,
    })
      .from(permissions)
      .where(eq(permissions.isActive, true))
      .orderBy(permissions.sortOrder, permissions.name),
  ])

  return { groups: groupRows, permissions: permissionRows }
}

async function buildUserPermissionSnapshot(userId: string): Promise<PermissionSnapshot> {
  const [targetUser] = await db.select({ id: users.id, role: users.role, brand: users.brand })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)

  if (!targetUser) {
    return { effective: {}, roleDefaults: {}, overrides: {} }
  }

  try {
    await ensurePermissionRegistrySynced()
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return buildRoleTemplateSnapshot(targetUser.role, targetUser.brand)
    }
    throw error
  }

  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(eq(permissions.isActive, true))

  const roleRows = await db.select({
    permissionId: rolePermissions.permissionId,
    allowed: rolePermissions.allowed,
  })
    .from(rolePermissions)
    .where(eq(rolePermissions.role, targetUser.role))

  const overrideRows = await db.select({
    permissionId: userPermissions.permissionId,
    allowed: userPermissions.allowed,
  })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))

  const keyById = new Map(permissionRows.map((permission) => [permission.id, permission.key]))
  const baseRoleDefaults = Object.fromEntries(permissionRows.map((permission) => [permission.key, false]))

  for (const row of roleRows) {
    const key = keyById.get(row.permissionId)
    if (key) baseRoleDefaults[key] = row.allowed
  }

  const overrides: Record<string, boolean> = {}
  for (const row of overrideRows) {
    const key = keyById.get(row.permissionId)
    if (key) overrides[key] = row.allowed
  }

  return resolveEffectiveSnapshotForMode(baseRoleDefaults, overrides, targetUser.role, targetUser.brand)
}

/**
 * Pure permission resolution — no database. Layers role defaults → branch role defaults →
 * brand default → global-access default → branch scope, then merges the user's explicit
 * overrides LAST so that an explicit Deny (allowed=false) wins over every default. Super Admins
 * (developer, md) always resolve to all-true and cannot be restricted. Other global-access roles
 * (ceo, ea, eba) DEFAULT to everything-except-admin-only but ARE restrictable via a Deny
 * override. Exported so the resolution rules can be unit-tested without standing up the database.
 */
export function resolveEffectiveSnapshot(
  baseRoleDefaults: Record<string, boolean>,
  overrides: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined,
): PermissionSnapshot {
  const roleDefaults = { ...baseRoleDefaults }
  applyBranchRoleDefaults(roleDefaults, role, branchAccess)
  applyBrandDefault(roleDefaults, role, branchAccess)
  // Non-super global-access roles (ceo/ea/eba) default to seeing everything except admin-only.
  // This used to live in the EFFECTIVE layer (after overrides merged), which silently clobbered
  // an explicit Deny — so the Access Map could never revoke a section from these roles. Applying
  // it to the DEFAULT layer instead lets a Deny override win, while everything else still
  // defaults to visible. It also makes the Access Map's `defaultVisible` correct, so unticking a
  // box computes a real Deny delta (false) rather than "inherit" (null).
  if (hasGlobalAccessRole(role) && !isSuperAdminRole(role)) {
    for (const key of Object.keys(roleDefaults)) roleDefaults[key] = !isAdminOnlyPermission(key) && !isRestrictedDefaultPermission(key)
  }
  // Sensitive reports: deny by default to roles outside the top-management allowlist (still grantable).
  applySensitiveReportDefaults(roleDefaults, role)
  constrainSnapshotToBranch(roleDefaults, role, branchAccess)

  // Overrides merge LAST, so an explicit Deny wins over the role / brand / global default.
  const effective = { ...roleDefaults, ...overrides }
  constrainSnapshotToBranch(effective, role, branchAccess)
  // Super Admins (developer, md) are never restrictable — the final guardrail so the top
  // administrators cannot be locked out of the console by a stray override.
  if (isSuperAdminRole(role)) {
    for (const key of Object.keys(effective)) effective[key] = true
  }

  return { effective, roleDefaults, overrides }
}

// ── Tiered (V2) resolver ───────────────────────────────────────────────────────────────────────
// The role's base defaults come from its INHERITED tier bundle (cumulative union of same-family
// templates at tier ≤ its own) instead of its single flat template — so higher tiers automatically
// include lower-tier access (the pyramid) and no role loses a grant it has today (the bundle is a
// superset of its own template). Every downstream layer (brand/dealer scope, global-access, sensitive
// gating, overrides, super-admin) is the SAME as V1, so the only behavioural delta is the inheritance
// gain. Special roles (branch_admin/call_agent/ca) use their own template (no inheritance).
export function buildTierRoleDefaults(role: PermissionRole): Record<string, boolean> {
  const base = Object.fromEntries(PERMISSIONS.map((permission) => [permission.key, false])) as Record<string, boolean>
  const profile = getRoleProfile(role)
  if (!profile) return base
  if (profile.family === 'super') {
    for (const key of Object.keys(base)) base[key] = true
    return base
  }
  // Tracked roles inherit their FUNCTION TRACK (service/sales/branch/finance) up to their tier;
  // special roles use their own template (no inheritance).
  const keys = profile.family === 'tracked' && profile.track
    ? tierBundleKeys(profile.track, profile.tier)
    : new Set(ROLE_PERMISSION_TEMPLATES[role] || [])
  for (const key of keys) if (key in base) base[key] = true
  return base
}

export function resolveEffectiveSnapshotV2(
  baseRoleDefaults: Record<string, boolean>,
  overrides: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined,
): PermissionSnapshot {
  // Union the DB role defaults with the inherited tier bundle, so nothing an admin granted at the
  // role level is lost AND the tier inheritance is added. The resolution pipeline is monotonic in its
  // base, so V2 effective is a provable SUPERSET of V1 — the flag flip cannot revoke anyone's access.
  const tierBase = buildTierRoleDefaults(role)
  const merged: Record<string, boolean> = { ...baseRoleDefaults }
  for (const key of Object.keys(tierBase)) if (tierBase[key]) merged[key] = true
  return resolveEffectiveSnapshot(merged, overrides, role, branchAccess)
}

// Flag-aware resolver: picks V2 (tiered, default) or V1 (legacy, PERMISSIONS_RESOLVER=v1). Use this at
// ANY call site that must match the LIVE resolution — e.g. the Access Map's bulk snapshot — so the
// admin UI's roleDefaults/defaultVisible track whatever resolver is actually live.
export function resolveEffectiveSnapshotForMode(
  baseRoleDefaults: Record<string, boolean>,
  overrides: Record<string, boolean>,
  role: PermissionRole,
  branchAccess: string | null | undefined,
): PermissionSnapshot {
  return USE_TIERED_RESOLVER
    ? resolveEffectiveSnapshotV2(baseRoleDefaults, overrides, role, branchAccess)
    : resolveEffectiveSnapshot(baseRoleDefaults, overrides, role, branchAccess)
}

export async function getUserPermissionSnapshot(userId: string) {
  return getCachedData(
    getPermissionCacheKey(userId),
    () => buildUserPermissionSnapshot(userId),
    PERMISSION_CACHE_TTL_SECONDS
  )
}

export async function canUserAccessPermission(appUser: AppUser | null, permissionKey: string): Promise<boolean> {
  if (!appUser || !appUser.isActive) return false
  if (isSuperAdminRole(appUser.role)) return true

  // Core bypass to ensure Sales Managers and General Sales Managers can always access Kia Proforma features
  if (permissionKey === 'kia.proforma.approve' && ['general_manager', 'sales_manager', 'finance_head', 'finance_team', 'md', 'admin', 'developer'].includes(appUser.role)) {
    return true
  }
  if (permissionKey === 'kia.proforma.view' && ['general_manager', 'sales_manager', 'finance_head', 'finance_team', 'md', 'admin', 'developer', 'manager', 'sales_executive'].includes(appUser.role)) {
    return true
  }

  // Neither brand NOR global-access roles short-circuit to `true` here anymore. Global roles
  // (ceo/ea/eba) still DEFAULT to seeing everything (except admin-only), but that default now
  // lives in the snapshot's roleDefaults, so an explicit Deny override can take precedence.
  // See resolveEffectiveSnapshot.
  const snapshot = await getUserPermissionSnapshot(appUser.id)
  return snapshot.effective[permissionKey] === true
}

export async function requirePermission(appUser: AppUser | null, permissionKey: string): Promise<PermissionCheckResult> {
  const allowed = await canUserAccessPermission(appUser, permissionKey)
  if (allowed) return { allowed: true }

  return {
    allowed: false,
    reason: 'You do not have access to this section. Please contact your administrator.',
  }
}

export async function updateUserPermissionOverrides(params: {
  targetUserId: string
  changedByUserId: string
  changes: Record<string, boolean | null>
  reason?: string
}) {
  const changeEntries = Object.entries(params.changes)
  if (changeEntries.length === 0) {
    return buildUserPermissionSnapshot(params.targetUserId)
  }

  await ensurePermissionRegistrySynced()

  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, changeEntries.map(([permissionKey]) => permissionKey)))

  const permissionByKey = new Map(permissionRows.map((permission) => [permission.key, permission]))
  const before = await buildUserPermissionSnapshot(params.targetUserId)
  const now = new Date()
  const auditRows: Array<typeof permissionAuditLogs.$inferInsert> = []
  const deletePermissionIds: string[] = []
  const upsertRows: Array<typeof userPermissions.$inferInsert> = []

  for (const [permissionKey, value] of changeEntries) {
    const permission = permissionByKey.get(permissionKey)
    if (!permission) continue

    const newEffectiveValue = value === null
      ? before.roleDefaults[permissionKey] === true
      : value

    if (value === null) {
      deletePermissionIds.push(permission.id)
    } else {
      upsertRows.push({
        userId: params.targetUserId,
        permissionId: permission.id,
        allowed: value,
        updatedAt: now,
      })
    }

    if (before.effective[permissionKey] !== newEffectiveValue) {
      auditRows.push({
        targetUserId: params.targetUserId,
        permissionId: permission.id,
        changedBy: params.changedByUserId,
        oldValue: before.effective[permissionKey] === true,
        newValue: newEffectiveValue,
        source: 'manual',
        reason: params.reason || null,
      })
    }
  }

  await Promise.all([
    deletePermissionIds.length > 0
      ? db.delete(userPermissions)
        .where(and(
          eq(userPermissions.userId, params.targetUserId),
          inArray(userPermissions.permissionId, deletePermissionIds)
        ))
      : Promise.resolve(),
    upsertRows.length > 0
      ? db.insert(userPermissions)
        .values(upsertRows)
        .onConflictDoUpdate({
          target: [userPermissions.userId, userPermissions.permissionId],
          set: {
            allowed: sql`excluded.allowed`,
            updatedAt: now,
          },
        })
      : Promise.resolve(),
    auditRows.length > 0
      ? db.insert(permissionAuditLogs).values(auditRows)
      : Promise.resolve(),
  ])

  await clearUserPermissionCache(params.targetUserId)
  return buildUserPermissionSnapshot(params.targetUserId)
}

// Editing a role's defaults changes every user who has that role, so their cached snapshots
// must be dropped.
async function invalidateRolePermissionCaches(role: PermissionRole) {
  const rows = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, role), isNull(users.deletedAt)))
  await Promise.all(rows.map((row) => clearUserPermissionCache(row.id)))
}

/** DB-backed role defaults as { role: { permissionKey: true } } — only granted keys are present. */
export async function getRolePermissionGrants(): Promise<Record<string, Record<string, boolean>>> {
  await ensurePermissionRegistrySynced()
  const rows = await db.select({
    role: rolePermissions.role,
    key: permissions.name,
    allowed: rolePermissions.allowed,
  })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))

  const grants: Record<string, Record<string, boolean>> = {}
  for (const row of rows) {
    if (!row.allowed) continue
    ;(grants[row.role] ||= {})[row.key] = true
  }
  return grants
}

/**
 * Update a role's default permissions. `changes` maps a permission key to whether the role
 * should grant it by default: true upserts a granted row, false removes the grant. Every
 * affected user's cache is invalidated.
 */
export async function updateRolePermissions(params: {
  role: PermissionRole
  changes: Record<string, boolean>
}) {
  const entries = Object.entries(params.changes)
  if (entries.length === 0) return getRolePermissionGrants()

  await ensurePermissionRegistrySynced()
  const permissionRows = await db.select({ id: permissions.id, key: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, entries.map(([key]) => key)))
  const idByKey = new Map(permissionRows.map((permission) => [permission.key, permission.id]))
  const now = new Date()

  const upsertRows: Array<typeof rolePermissions.$inferInsert> = []
  const removeIds: string[] = []
  for (const [key, granted] of entries) {
    const permissionId = idByKey.get(key)
    if (!permissionId) continue
    if (granted) upsertRows.push({ role: params.role, permissionId, allowed: true, updatedAt: now })
    else removeIds.push(permissionId)
  }

  await Promise.all([
    removeIds.length > 0
      ? db.delete(rolePermissions).where(and(
        eq(rolePermissions.role, params.role),
        inArray(rolePermissions.permissionId, removeIds),
      ))
      : Promise.resolve(),
    upsertRows.length > 0
      ? db.insert(rolePermissions).values(upsertRows).onConflictDoUpdate({
        target: [rolePermissions.role, rolePermissions.permissionId],
        set: { allowed: sql`excluded.allowed`, updatedAt: now },
      })
      : Promise.resolve(),
  ])

  await invalidateRolePermissionCaches(params.role)
  return getRolePermissionGrants()
}
