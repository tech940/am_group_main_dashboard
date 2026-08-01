import {
  PERMISSIONS,
  ROLE_PERMISSION_TEMPLATES,
  SECTION_ROUTES,
  type PermissionRole,
} from '@/lib/permissions/registry'

// ── Tiered ("pyramid") access model, function-aware ─────────────────────────────────────────────
// The old model is 22 flat, independent role→permission arrays with no inheritance. This adds an
// ordered TIER each role maps to; higher tiers INHERIT lower-tier access + a delta, so we stop
// re-granting the same sections to every role. Roles stay as job-title labels (approval / workflow
// logic keys on the role string) — tier is an additive axis, and brand/dealer scope stays a SEPARATE
// axis on top (a Manager still only sees their own brand).
//
// Inheritance is scoped to a role's FUNCTION TRACK (service / sales / branch-generalist / finance):
// a role inherits only same-track roles at a lower tier, so a General SERVICE Manager does not pick
// up SALES access and vice-versa. 'branch' is the generalist track (roles that legitimately do both,
// e.g. Employee/Manager).
//
// PURE DATA + derivation. Consumed by the parallel V2 resolver (buildTierRoleDefaults in service.ts),
// selected only behind the PERMISSIONS_RESOLVER=v2 flag; the live resolver is unchanged until the
// Phase-4 cutover. scripts/verify-snapshot-parity.ts diffs OLD vs V2.

export const TIER = {
  EMPLOYEE: 0, // front-line
  SUPERVISOR: 1, // Assistant Manager — above front-line, below a full Manager
  MANAGER: 2,
  HEAD: 3, // GM / department head
  LEADERSHIP: 4, // global-access
  SUPER_ADMIN: 5, // absolute, all-true
} as const

export type Tier = typeof TIER[keyof typeof TIER]

// 'tracked' roles ride the pyramid within their FUNCTION TRACK. 'special' roles are single-purpose
// bundles that inherit nothing. 'super' is all-true.
export type RoleFamily = 'tracked' | 'special' | 'super'

// Function tracks. Inheritance flows within a track only.
//   service — aftersales / workshop           sales — retail / bookings / proforma
//   branch  — generalist (does both)          finance — POs / finance-orders / petty cash / am-finance
export type RoleTrack = 'service' | 'sales' | 'branch' | 'finance'

export type RoleProfile = { tier: Tier; family: RoleFamily; track?: RoleTrack }

// Exhaustive Record → tsc fails if a role is missing (matches ROLE_PERMISSION_TEMPLATES).
export const ROLE_PROFILE: Record<PermissionRole, RoleProfile> = {
  // Super-admin (absolute)
  developer: { tier: TIER.SUPER_ADMIN, family: 'super' },
  md: { tier: TIER.SUPER_ADMIN, family: 'super' },
  admin: { tier: TIER.SUPER_ADMIN, family: 'super' },
  // Leadership (global access — bundle is overwritten by the resolver, track is nominal)
  ceo: { tier: TIER.LEADERSHIP, family: 'tracked', track: 'branch' },
  ea: { tier: TIER.LEADERSHIP, family: 'tracked', track: 'branch' },
  eba: { tier: TIER.LEADERSHIP, family: 'tracked', track: 'branch' },
  ed: { tier: TIER.LEADERSHIP, family: 'tracked', track: 'branch' },
  vp: { tier: TIER.LEADERSHIP, family: 'tracked', track: 'branch' },
  // Head / GM — split by function
  general_manager: { tier: TIER.HEAD, family: 'tracked', track: 'sales' }, // "General Sales Manager"
  sales_head: { tier: TIER.HEAD, family: 'tracked', track: 'sales' },
  service_manager: { tier: TIER.HEAD, family: 'tracked', track: 'service' },
  service_general_manager: { tier: TIER.HEAD, family: 'tracked', track: 'service' }, // "General Service Manager"
  // Manager
  manager: { tier: TIER.MANAGER, family: 'tracked', track: 'branch' }, // generalist branch manager
  // Supervisor rung on the generalist track, so its bundle is the union of BRANCH-track roles at
  // tier <= 1 — i.e. `viewer` plus itself. Putting it at MANAGER instead would inherit `manager`'s
  // whole template (same track, same tier) and hand an Assistant Manager approve + audit rights.
  assistant_manager: { tier: TIER.SUPERVISOR, family: 'tracked', track: 'branch' },
  sales_manager: { tier: TIER.MANAGER, family: 'tracked', track: 'sales' },
  // Employee (front-line)
  viewer: { tier: TIER.EMPLOYEE, family: 'tracked', track: 'branch' }, // generalist "Employee"
  technician: { tier: TIER.EMPLOYEE, family: 'tracked', track: 'service' },
  sales_executive: { tier: TIER.EMPLOYEE, family: 'tracked', track: 'sales' },
  // Finance / purchasing (its own function track)
  finance_head: { tier: TIER.HEAD, family: 'tracked', track: 'finance' },
  purchase_manager: { tier: TIER.MANAGER, family: 'tracked', track: 'finance' },
  accounts: { tier: TIER.MANAGER, family: 'tracked', track: 'finance' },
  finance_team: { tier: TIER.MANAGER, family: 'tracked', track: 'finance' },
  // Special single-purpose (own bundle, no inheritance)
  branch_admin: { tier: TIER.EMPLOYEE, family: 'special' },
  call_agent: { tier: TIER.EMPLOYEE, family: 'special' },
  ca: { tier: TIER.EMPLOYEE, family: 'special' },
  // 'special' with NO track is load-bearing for these two: it makes them deny-by-default and stops
  // them inheriting a tier bundle (a shared track would leak permissions between same-tier roles —
  // see the finance track). They exist to OWN one action each, not to accumulate access.
  crm: { tier: TIER.EMPLOYEE, family: 'special' }, // Customer Relationship Manager — marks vehicles delivered
  idt: { tier: TIER.EMPLOYEE, family: 'special' }, // Internal Development Trainee — allots vehicles to bookings
  cre: { tier: TIER.EMPLOYEE, family: 'special' }, // Customer Relationship Executive — calls customers, owns booking follow-ups
  edp: { tier: TIER.EMPLOYEE, family: 'special' }, // Electronic Data Processing — manages price list
  ccm: { tier: TIER.EMPLOYEE, family: 'special' },
  cxm: { tier: TIER.EMPLOYEE, family: 'special' },
  process_coordinator: { tier: TIER.EMPLOYEE, family: 'special' },
}

export function getRoleProfile(role: string | null | undefined): RoleProfile | null {
  return (role && ROLE_PROFILE[role as PermissionRole]) || null
}

// ── Cumulative track bundles (provably no-loss) ────────────────────────────────────────────────
// A tracked role's bundle is the UNION of the current templates of every SAME-TRACK role at tier ≤ N.
// So a role's bundle is a SUPERSET of its own template (nobody loses a grant on migration) AND it
// inherits every lower tier IN ITS FUNCTION (the pyramid gain, without crossing service↔sales).
// Derived from ROLE_PERMISSION_TEMPLATES so the bundles track the registry automatically.
const ROLES = Object.keys(ROLE_PROFILE) as PermissionRole[]
const trackBundleCache = new Map<string, Set<string>>()

export function tierBundleKeys(track: RoleTrack, tier: Tier): Set<string> {
  const cacheKey = `${track}:${tier}`
  const cached = trackBundleCache.get(cacheKey)
  if (cached) return cached
  const keys = new Set<string>()
  for (const role of ROLES) {
    const profile = ROLE_PROFILE[role]
    if (profile.family !== 'tracked' || profile.track !== track) continue
    if (profile.tier > tier) continue
    for (const key of ROLE_PERMISSION_TEMPLATES[role] || []) keys.add(key)
  }
  trackBundleCache.set(cacheKey, keys)
  return keys
}

// ── Per-section minimum tier (scaffolding for the later minTier cleanup) ────────────────────────
// One knob per navigable section: the lowest tier that sees it by default. This is intended to
// eventually subsume DEFAULT_VISIBLE_SECTIONS / RESTRICTED_DEFAULT_SECTIONS / SENSITIVE_REPORT_SECTIONS.
// The conservative V2 resolver does NOT consult it yet (it keeps the existing gating for safety);
// it is defined here so the follow-up can adopt it under parity. New/unknown sections default to
// SUPER_ADMIN (deny-by-default) so a new sidebar section still reaches no one but Dev/MD until placed.
export const DEFAULT_SECTION_MIN_TIER: Tier = TIER.EMPLOYEE

export const SECTION_MIN_TIER: Partial<Record<string, Tier>> = {
  cockpit: TIER.LEADERSHIP,
  ca: TIER.SUPER_ADMIN,
  'kia.sales_report': TIER.LEADERSHIP,
  'kia.stock_report': TIER.LEADERSHIP,
  'kia.sales_performance': TIER.MANAGER,
  'kia.call_analytics': TIER.MANAGER,
  'kia.allocation_history': TIER.MANAGER,
  'kia.lead_followups': TIER.EMPLOYEE,
  'kia.call_center': TIER.MANAGER,
  user_management: TIER.SUPER_ADMIN,
  access_control: TIER.SUPER_ADMIN,
  admin_audit: TIER.SUPER_ADMIN,
  dashboard_settings: TIER.SUPER_ADMIN,
}

const ROUTED_SECTIONS = new Set(Object.keys(SECTION_ROUTES))
const groupByPermissionKey = new Map(PERMISSIONS.map((p) => [p.key, p.groupKey]))

export function sectionMinTierForPermission(permissionKey: string): Tier {
  const groupKey = groupByPermissionKey.get(permissionKey)
  if (!groupKey) return DEFAULT_SECTION_MIN_TIER
  const parts = groupKey.split('.')
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join('.')
    if (ROUTED_SECTIONS.has(candidate) || candidate in SECTION_MIN_TIER) {
      return SECTION_MIN_TIER[candidate] ?? DEFAULT_SECTION_MIN_TIER
    }
  }
  return SECTION_MIN_TIER[groupKey] ?? DEFAULT_SECTION_MIN_TIER
}
