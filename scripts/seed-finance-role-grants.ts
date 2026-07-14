/**
 * Grants the Finance section to EXACTLY finance_head + finance_team.
 *
 * WHY a DB seed and not ROLE_PERMISSION_TEMPLATES: under the live V2 tiered resolver a role's base is a
 * cumulative same-track tier bundle. finance_team / accounts / purchase_manager are all tier-2
 * finance-track roles with a byte-identical bundle, so putting finance.* in finance_team's TEMPLATE
 * would leak the section to accounts + purchase_manager too. DB role_permissions rows are unioned into
 * the effective snapshot but are NOT read by the tier bundle, so seeding them hits only the two roles.
 *
 * Idempotent. Also ensures the finance permission_group + permissions rows exist so it can run
 * independent of the app's first-load registry sync.
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // 1. Ensure the 'finance' group + its two permissions exist (mirrors lib/permissions/registry.ts;
    //    the app's syncPermissionRegistry will re-confirm the same values on next load).
    await sql`
      INSERT INTO permission_groups (key, name, parent_key, description, sort_order, is_active)
      VALUES ('finance', 'Finance', NULL, 'Customer vehicle-financing workflow.', 57, true)
      ON CONFLICT (key) DO NOTHING`
    await sql`
      INSERT INTO permissions (name, group_key, label, description, resource, action, sort_order, is_active)
      VALUES
        ('finance.view', 'finance', 'Finance: View', 'View access for Finance.', 'finance', 'view', 570, true),
        ('finance.approve', 'finance', 'Finance: Approve', 'Approve access for Finance.', 'finance', 'approve', 571, true)
      ON CONFLICT (name) DO NOTHING`

    // 2. Grant BOTH permissions to finance_head + finance_team via role_permissions DB rows.
    const perms = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM permissions WHERE name IN ('finance.view', 'finance.approve')`
    const roles = ['finance_head', 'finance_team']
    let granted = 0
    for (const role of roles) {
      for (const perm of perms) {
        const res = await sql`
          INSERT INTO role_permissions (role, permission_id, allowed)
          VALUES (${role}, ${perm.id}, true)
          ON CONFLICT (role, permission_id) DO NOTHING
          RETURNING id`
        granted += res.length
      }
    }
    console.log(`Finance grants ensured for finance_head + finance_team (finance.view + finance.approve). New role_permission rows: ${granted}.`)
    console.log('NOTE: cached permission snapshots for logged-in finance users refresh within ~75min or on next login; or bump PERMISSION_CACHE_VERSION to force-refresh.')
    process.exit(perms.length === 2 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Finance role grant seed failed:', error); process.exit(1) })
