import 'server-only'

import { createHash } from 'crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getRedisClient } from '@/lib/redis/client'
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

// Bumped for each new role or permission key (v16 delegation_tasks, v17 kia.approvals, v18 scrap_erp & kia.booking_payment_history, v19 ccm lead_followups, v20 eba scrap_erp access, v21 scrap_erp default visible, v22 kia.allocation_history, v23 assistant_manager, v24 accounts vendor payments & registry) — cached snapshots are keyed on this, so without a bump an
// existing session would carry stale permissions for up to the cache TTL.
// v25 is a POISON FLUSH, not a new permission. While the role enum was missing
// 'process_coordinator' (migration 0030), buildUserPermissionSnapshot returned a
// role-template-only snapshot with every user override stripped — and getUserPermissionSnapshot
// cached that degraded result for the full 75-minute TTL. Fixing the enum alone would have left
// affected users locked out until their entry expired; bumping the version orphans every poisoned
// v26 registers bank_sanctions in PERMISSION_GROUPS and SECTION_ROUTES for Access Map control.
// v30 — `kia.approvals` is treated as brand-neutral (it is a common, all-brand section).
// v29 — the resolver now keeps an explicit Access-Map Allow through brand constraining (see
// resolveEffectiveSnapshot). ⚠️ THE BUMP IS LOAD-BEARING, not decoration: every logged-in user
// holds a snapshot computed by the OLD rules for up to the 75-minute TTL, so without it the people
// this fixes stay locked out for another hour and it reads as "the fix did not work".
// v31: adds the group_service_manager role. A new role changes every snapshot's shape, so a
// stale v30 entry would resolve it as having no template at all.
// v32: registers fuel_approvals in PERMISSION_GROUPS and SECTION_ROUTES for Access Map control.
const PERMISSION_CACHE_VERSION = 'v32'
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

const PERMISSION_TABLE_NAMES = [
  'permission_groups',
  'permissions',
  'role_permissions',
  'user_permissions',
  'permission_audit_logs',
] as const

/** Walk the `cause` chain — Drizzle wraps driver errors, so SQLSTATE is never on the outer error. */
function collectSqlStates(error: unknown) {
  const states = new Set<string>()
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') states.add(code)
    current = (current as { cause?: unknown }).cause
  }
  return states
}

/**
 * True ONLY when a permission table genuinely does not exist.
 *
 * ⚠️ This used to substring-match the error MESSAGE for names like 'permissions' and
 * 'role_permissions'. That is unsound: Drizzle 0.45 wraps every driver error in a
 * DrizzleQueryError whose message is the entire failed statement, so ANY error on these tables —
 * a constraint violation, a bad enum value, a type mismatch, a timeout — contained the table name
 * and was read as "the tables are not installed".
 *
 * It caused a real, total access-control outage. `process_coordinator` was added to the code's
 * roleEnum without the matching `ALTER TYPE` reaching Postgres (migration 0030). Every
 * syncPermissionRegistry() insert then failed with 22P02; the wrapped message contained
 * "role_permissions"; this function returned true; and both callers below "gracefully degraded" to
 * a role-template-only snapshot — silently discarding all 205 Access Map grants. Users lost
 * sections while the admin UI still showed their checkbox ticked, because the Access Map reads the
 * stored user_permissions row while the sidebar reads the snapshot.
 *
 * So: match on SQLSTATE 42P01 (undefined_table) and nothing else. A missing table is the ONLY
 * condition under which discarding overrides is safe — there are none to discard. Every other
 * error must propagate loudly rather than quietly stripping people's access.
 */
export function isMissingPermissionTableError(error: unknown) {
  if (!collectSqlStates(error).has('42P01')) return false
  // 42P01 from an unrelated table is not our concern — don't claim the permission stack is missing.
  const message = error instanceof Error ? error.message : String(error)
  return PERMISSION_TABLE_NAMES.some((table) => message.includes(table))
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

/*
 * ── Sections that are COMMON to every branch despite a brand-prefixed key ─────────────────────
 *
 * Vendor Payment Approvals started life as a KIA screen and its permission group is still
 * `kia.approvals` (route /brands/kia/payment-approvals). The SECTION is no longer KIA's — every
 * brand files payment requests through it, and the first approval stage is routed per brand
 * (lib/approvals/first-stage-approver.ts). The key simply never caught up with the product.
 *
 * That mismatch had a real cost: brand constraining reads the `kia.` prefix and strips the key from
 * every non-KIA user, so a Hyundai `accounts` or `ea` — whose ROLE TEMPLATE grants it — silently got
 * nothing, and the multi-brand routing was inert for the people it was built for.
 *
 * ⚠️ WHY NOT JUST RENAME THE KEY: syncPermissionRegistry upserts `permissions` with
 * `target: permissions.name`, and `name` IS the key. A new key therefore creates a NEW row with a
 * NEW id, while `user_permissions.permission_id` still points at the old one — **22 live grants
 * would stop working, silently**. Renaming needs a migration that remaps those rows first; until
 * then the honest fix is to stop pretending this key means a brand.
 *
 * Listing a group here means "brand assignment does not gate this section". It does NOT mean the
 * DATA is unscoped: approvals rows are still filtered per branch by lib/kia/approval-scope.ts.
 */
const BRAND_NEUTRAL_PERMISSION_GROUPS = new Set<string>(['kia.approvals'])

function isBrandNeutralGroup(groupKey: string): boolean {
  return [...BRAND_NEUTRAL_PERMISSION_GROUPS].some(
    (group) => groupKey === group || groupKey.startsWith(`${group}.`)
  )
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
    // Common-to-every-branch sections keep their historical brand prefix but are not brand-gated.
    if (isBrandNeutralGroup(permission.groupKey)) continue
    const isAssignedBranch = prefixes.some((prefix) =>
      permission.groupKey === prefix || permission.groupKey.startsWith(`${prefix}.`)
    )
    if (!isAssignedBranch) values[permission.key] = false
  }
}

// Roles whose access is defined purely by their role template — they do NOT receive the
// blanket "see your whole brand" default. This moves two former sidebar hardcodes into the
// resolution layer: branch_admin (Petty Cash only) and sales_executive (Bookings only).
//
// ⚠️ OMITTING A SINGLE-PURPOSE ROLE HERE IS SILENT AND EXPENSIVE. The Set is typed, so a typo is
// caught — but membership is NOT exhaustive, so a role simply left out compiles cleanly and then
// receives applyBrandDefault's blanket grant of every non-restricted kia.* key. Measured for the two
// roles added below: WITHOUT this line cxm resolved to 27 effective keys and ccm to 30 (including
// kia.proforma.approve and kia.stock_management.audit) instead of the 2 their templates intend.
// Any new role that exists to own ONE action belongs in this Set, in the same commit that adds it.
//
// 'crm' STAYS even though it is retired: removing it would widen any lingering crm user from 2 keys
// to ~28 on their way out the door.
const TEMPLATE_ONLY_ROLES = new Set<PermissionRole>(['branch_admin', 'sales_executive', 'call_agent', 'ca', 'crm', 'idt', 'cre', 'cxm', 'ccm'])

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

// A stable fingerprint of the registry CONSTANTS. The DB seed (syncPermissionRegistry) is derived
// purely from these three, so it changes only when the code's permission definitions change — i.e. on
// deploy. When this exact fingerprint is already marked in Redis, the DB is current and the multi-
// statement write-sweep (~2.9s, measured) is pure waste. Only the FIRST instance after a deploy pays
// it; every cold instance after that skips with one Redis GET. This was the dominant cold-start cost
// on EVERY requirePermission-gated endpoint.
const REGISTRY_FINGERPRINT = createHash('sha1')
  .update(JSON.stringify([PERMISSION_GROUPS, PERMISSIONS, ROLE_PERMISSION_TEMPLATES]))
  .digest('hex').slice(0, 16)
const REGISTRY_SYNC_MARK_KEY = `perm:registry:synced:${REGISTRY_FINGERPRINT}`
const REGISTRY_SYNC_MARK_TTL_SECONDS = 7 * 24 * 60 * 60 // rotates naturally on the next deploy (new fingerprint)

export async function ensurePermissionRegistrySynced(): Promise<void> {
  if (Date.now() < registrySyncedUntil) return              // per-process fast path (10 min)
  if (registrySyncPromise) return registrySyncPromise
  registrySyncPromise = (async () => {
    // Cross-instance skip: if this registry fingerprint is already marked in Redis, the DB seed is
    // current — avoid the ~2.9s write-sweep entirely. Redis errors fall through to running the sync
    // (fail-safe: correctness over speed). A missing/unreachable Redis just means we behave as before.
    let alreadySynced = false
    try {
      const redis = getRedisClient()
      if (redis) alreadySynced = Boolean(await redis.get(REGISTRY_SYNC_MARK_KEY))
    } catch { /* fall through and sync */ }

    if (!alreadySynced) {
      await syncPermissionRegistry()
      try {
        const redis = getRedisClient()
        if (redis) await redis.setex(REGISTRY_SYNC_MARK_KEY, REGISTRY_SYNC_MARK_TTL_SECONDS, '1')
      } catch { /* best-effort marker; a failed set just means the next cold instance re-syncs */ }
    }
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
      // This path DISCARDS every user_permissions override — it is only sound when the tables do
      // not exist (there is nothing to discard). It is never routine, and it must never be silent:
      // a misclassified error here strips real people's access while the admin UI still shows the
      // grant ticked, which is exactly how the process_coordinator outage went unnoticed.
      console.error(
        '[permissions] permission tables missing — falling back to a role-template-only snapshot; '
        + `ALL overrides for user ${targetUser.id} are being ignored.`,
        error,
      )
      return buildRoleTemplateSnapshot(targetUser.role, targetUser.brand)
    }
    throw error
  }

  // ORDER BY is load-bearing, not cosmetic. Without it Postgres returns heap order, which SHIFTS
  // whenever syncPermissionRegistry() upserts these rows — so the resulting snapshot object gets a
  // different key order for identical permissions. The Sidebar compares successive maps to decide
  // whether access changed; an order flip read as "changed" and fired router.refresh(), which
  // re-rendered, refetched, re-synced, and flipped again — an endless RSC loop on every page.
  // Deterministic order also keeps the payload byte-stable for caching and structural sharing.
  // These three reads are independent — run them in ONE round-trip instead of three sequential ones
  // (~2 RTT / ~700 ms saved on every cache-miss snapshot build, the cold-start path).
  const [permissionRows, roleRows, overrideRows] = await Promise.all([
    db.select({ id: permissions.id, key: permissions.name })
      .from(permissions)
      .where(eq(permissions.isActive, true))
      .orderBy(permissions.name),
    db.select({ permissionId: rolePermissions.permissionId, allowed: rolePermissions.allowed })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, targetUser.role)),
    db.select({ permissionId: userPermissions.permissionId, allowed: userPermissions.allowed })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId)),
  ])

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

  /*
   * ── An explicit Access-Map Allow is NEVER silently discarded ──────────────────────────────────
   *
   * ⚠️ THE BUG THIS FIXES, measured on a live user: a Service GM at Hyundai was granted `kia.view`,
   * `kia.sales.view` and `kia.payment_window_requests.view` in the Access Map. All three were stored
   * as `allowed = true` in `user_permissions`. All three resolved to FALSE — because
   * constrainSnapshotToBranch runs on `effective` AFTER the overrides merge and zeroes every
   * brand-prefixed key outside the user's own brand. The admin ticked the box, the database agreed,
   * and the resolver quietly deleted the decision. Nothing surfaced it anywhere.
   *
   * It is not specific to that role or that brand: it silently voided EVERY cross-brand grant for
   * EVERY user, and it is why the multi-brand Approvals section — whose key is still `kia.approvals`
   * — could never be opened by a Hyundai or Platinum login however many boxes you ticked.
   *
   * The layers have different jobs and this restores that separation:
   *   role template / tier / brand / global-access  -> DEFAULTS. What you get without anyone asking.
   *   an override                                    -> A DECISION about one user and one key.
   * A default must not overrule a decision. Brand scoping is a default, so it shapes `roleDefaults`
   * (constrained above, deliberately untouched) and stops there.
   *
   * Only `true` is re-applied, so an explicit DENY still wins over everything — the property the
   * merge order was protecting in the first place. This is the same principle as
   * isPermissionExplicitlyAllowed in lib/permissions/deny.ts: ticking one box widens access by
   * exactly one user and one key, which is what ticking it is supposed to mean.
   */
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === true && key in effective) effective[key] = true
  }

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
