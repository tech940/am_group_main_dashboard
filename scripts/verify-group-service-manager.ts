/**
 * The `group_service_manager` role — wired, routed, and reachable.
 *
 * A new role misbehaves SILENTLY when one of its six wiring points is missed: it exists, can be
 * assigned, and simply resolves to no permissions. So this asserts the wiring from the outside —
 * the enum value, the template, the tier profile — rather than trusting that the edits landed.
 *
 * Read-only. Run: npm run verify:group-service-manager
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import {
  firstStageApproverRoles, firstStageLabel, usesGroupServiceManager, brandHasEd,
} from '../lib/approvals/first-stage-approver'
import { ROLE_PERMISSION_TEMPLATES, ROLE_PERMISSION_TEMPLATE_LABELS } from '../lib/permissions/registry'
import { ROLE_PROFILE } from '../lib/permissions/tiers'

const ROLE = 'group_service_manager'
let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

async function main() {
  console.log('1) The role exists everywhere it must')

  const [enumRow] = await analyticsExecute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role' AND e.enumlabel = ${ROLE}
    ) AS present`)
  check(enumRow.present === true, 'the DB role enum carries the value (migration 0049 applied)')

  const label = (ROLE_PERMISSION_TEMPLATE_LABELS as Record<string, string>)[ROLE]
  console.log(`   label: ${label || '(none)'}`)
  check(Boolean(label), 'it has a template label, so Admin can offer it')

  const template = (ROLE_PERMISSION_TEMPLATES as Record<string, string[]>)[ROLE] || []
  console.log(`   template keys: ${template.length}`)
  check(template.length > 0, 'it has a permission template (without one it resolves to nothing)')

  const profile = (ROLE_PROFILE as Record<string, { tier: number; track: string }>)[ROLE]
  console.log(`   tier profile: ${profile ? `tier=${profile.tier} track=${profile.track}` : '(none)'}`)
  check(Boolean(profile), 'it has a tier profile')
  check(profile?.track === 'service', 'it sits on the service track')

  console.log('\n2) It can reach the Approvals section it exists to work in')
  /*
   * The all-brand Approvals section is gated by the legacy `kia.approvals` key — the name is a
   * historical artefact, not a brand claim. Without it this role opens to nothing.
   */
  check(template.includes('kia.approvals.view'), 'the template grants kia.approvals.view (the ALL-BRAND Approvals gate)')
  check(template.some((k) => k.startsWith('hyundai.')), 'it can see Hyundai')
  check(template.some((k) => k.startsWith('platinum.')), 'it can see Platinum')
  check(!template.some((k) => k.startsWith('kia.') && k !== 'kia.approvals.view'),
    'it gets NO other KIA key — KIA service stays with service_general_manager')

  console.log('\n3) Service approvals route to it — and only for its brands')
  for (const brand of ['hyundai', 'platinum', 'kia', 'tata']) {
    const service = firstStageApproverRoles(brand, 'Service')
    const sales = firstStageApproverRoles(brand, 'Sales')
    console.log(`   ${brand.padEnd(9)} service -> ${service.join(', ').padEnd(24)} sales -> ${sales.join(', ')}`)
    if (brand === 'hyundai' || brand === 'platinum') {
      check(service.includes(ROLE), `${brand} service routes to the Group Service Manager`)
      check(!sales.includes(ROLE), `${brand} SALES does not — it stays with the sales GSM`)
    } else if (brand === 'kia') {
      check(service.join() === 'ed' && sales.join() === 'ed', 'KIA is untouched — still the ED')
    } else {
      check(!service.includes(ROLE), `${brand} service still uses its own GSM, not the group role`)
    }
  }

  console.log('\n4) The label on screen names the right person')
  console.log(`   hyundai/Service: "${firstStageLabel('hyundai', 'Service')}"`)
  console.log(`   tata/Service   : "${firstStageLabel('tata', 'Service')}"`)
  check(firstStageLabel('hyundai', 'Service').includes('Group Service Manager'),
    'a Hyundai service request names the Group Service Manager')
  check(usesGroupServiceManager('hyundai') && usesGroupServiceManager('platinum'), 'both brands map to the group role')
  check(!usesGroupServiceManager('kia') && brandHasEd('kia'), 'KIA still has its ED and is not remapped')

  console.log('\n5) Who holds the role today')
  const holders = await analyticsExecute<{ full_name: string; brand: string | null; is_active: boolean }>(sql`
    SELECT full_name, brand, is_active FROM public.users WHERE role = ${ROLE}`)
  if (!holders.length) {
    console.log('   nobody yet — assign it in Admin, with brand set to hyundai,platinum')
    console.log('   ⚠️ Until someone holds it, Hyundai and Platinum SERVICE approvals have no first-stage')
    console.log('      approver and will sit unactioned. This is the staffing gap that stalled the')
    console.log('      service GSM queue before.')
  }
  for (const h of holders) console.log(`   ${h.full_name} brand=${h.brand || '-'} active=${h.is_active}`)

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
