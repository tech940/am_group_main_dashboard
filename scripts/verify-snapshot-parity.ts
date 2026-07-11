/**
 * Snapshot parity — the safety oracle for the tiered (V2) resolver. For every role × representative
 * brand, it diffs the OLD (flat-template) effective snapshot against the NEW (inherited-tier) one and
 * reports:
 *   LOSSES  — keys the OLD model granted that V2 denies. MUST be zero: nobody may lose access.
 *   GAINS   — keys V2 grants that OLD did not. The intended inheritance (reviewed before cutover).
 *
 * The V2 base is the cumulative tier bundle (a superset of each role's own template) run through the
 * SAME resolution pipeline, so losses are expected to be zero by construction. This script proves it.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-snapshot-parity.ts
 */
import 'dotenv/config'
import { resolveEffectiveSnapshot, resolveEffectiveSnapshotV2 } from '../lib/permissions/service'
import { PERMISSIONS, ROLE_PERMISSION_TEMPLATES, ROLE_PERMISSION_TEMPLATE_LABELS, type PermissionRole } from '../lib/permissions/registry'
import { ROLE_PROFILE, TIER } from '../lib/permissions/tiers'

const ALL_KEYS = PERMISSIONS.map((p) => p.key)
const TIER_NAME: Record<number, string> = {
  [TIER.EMPLOYEE]: 'Employee', [TIER.SUPERVISOR]: 'Supervisor', [TIER.MANAGER]: 'Manager',
  [TIER.HEAD]: 'Head/GM', [TIER.LEADERSHIP]: 'Leadership', [TIER.SUPER_ADMIN]: 'Super-admin',
}

// OLD baseline: what a freshly-seeded role gets — the role's OWN template as the base, then the V1
// pipeline. (DB drift is a separate Phase-2 concern; the code template is the intended baseline.)
function ownTemplateBase(role: PermissionRole): Record<string, boolean> {
  const base = Object.fromEntries(ALL_KEYS.map((k) => [k, false])) as Record<string, boolean>
  for (const key of ROLE_PERMISSION_TEMPLATES[role] || []) if (key in base) base[key] = true
  return base
}

const BRANDS: Array<string | null> = ['kia', 'hyundai', 'all', null]
const roles = (Object.keys(ROLE_PROFILE) as PermissionRole[]).sort(
  (a, b) => ROLE_PROFILE[a].tier - ROLE_PROFILE[b].tier || a.localeCompare(b),
)

// Collapse a set of permission keys to their unique section (groupKey) for a readable summary.
const groupByKey = new Map(PERMISSIONS.map((p) => [p.key, p.groupKey]))
function sections(keys: Set<string>): string[] {
  return [...new Set([...keys].map((k) => groupByKey.get(k) || k))].sort()
}

let totalLosses = 0
console.log('\n=== Tiered resolver parity (OLD flat template → V2 inherited tier) ===\n')

for (const role of roles) {
  const profile = ROLE_PROFILE[role]
  const lossKeys = new Set<string>()
  const gainKeys = new Set<string>()
  for (const brand of BRANDS) {
    const v1 = resolveEffectiveSnapshot(ownTemplateBase(role), {}, role, brand).effective
    const v2 = resolveEffectiveSnapshotV2(ownTemplateBase(role), {}, role, brand).effective
    for (const key of ALL_KEYS) {
      const a = v1[key] === true
      const b = v2[key] === true
      if (a && !b) lossKeys.add(key)
      if (!a && b) gainKeys.add(key)
    }
  }
  totalLosses += lossKeys.size
  const label = ROLE_PERMISSION_TEMPLATE_LABELS[role]
  const tag = `${TIER_NAME[profile.tier]}/${profile.family}`
  const flag = lossKeys.size > 0 ? 'LOSS' : (gainKeys.size > 0 ? 'gain' : 'same')
  console.log(`  [${flag}] ${label} (${role}) — ${tag}: ${lossKeys.size} loss, ${gainKeys.size} gain`)
  if (lossKeys.size > 0) {
    console.log(`        LOSSES: ${sections(lossKeys).join(', ')}`)
  }
  if (gainKeys.size > 0) {
    console.log(`        gains: ${sections(gainKeys).join(', ')}`)
  }
}

console.log(`\nTotal LOSSES across all roles: ${totalLosses}`)
console.log(totalLosses === 0
  ? '=== PARITY OK — no role loses access under the tiered resolver ==='
  : `=== ${totalLosses} LOSS KEY(S) — tier bundles must be widened before cutover ===`)
process.exit(totalLosses === 0 ? 0 : 1)
