/**
 * One-time data repair script.
 * Fixes records where MD approved at the EA stage instead of the MD stage:
 *   eaApproval = 'APPROVED'  (set by MD on wrong stage)
 *   managementApproval = null or ''  (MD's real approval never recorded)
 *
 * Run: npx tsx scripts/fix-ea-to-md.ts
 */
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  console.log('🔍 Finding stuck records...')

  // Find all candidates
  const candidates = await sql`
    SELECT id, ea_approval, management_approval, email_send_status, history, name, email
    FROM kia_approval_requests
    WHERE ea_approval = 'APPROVED'
      AND (management_approval IS NULL OR management_approval = '')
      AND payment_status != 'PAID'
  `

  if (candidates.length === 0) {
    console.log('✅ No stuck records found. Nothing to migrate.')
    await sql.end()
    return
  }

  console.log(`📋 Found ${candidates.length} stuck record(s). Fixing...`)

  let migrated = 0

  for (const row of candidates) {
    const history = Array.isArray(row.history) ? [...row.history] : []

    // Find who originally set the EA approval
    const eaEntry = history.find(
      (h: any) => h.roleKey === 'ea' && h.action === 'APPROVED'
    )
    const eaActor: string = eaEntry?.user || 'Unknown'

    // Append corrective audit entry
    history.push({
      id: Math.random().toString(36).substring(7),
      role: 'MD',
      roleKey: 'md',
      user: 'System (data repair script)',
      action: 'APPROVED',
      remarks: `[Data repair] MD approval recorded retroactively. Previously approved at EA stage by "${eaActor}" due to a routing bug (now fixed).`,
      timestamp: new Date().toISOString(),
    })

    await sql`
      UPDATE kia_approval_requests
      SET
        management_approval = 'APPROVED',
        email_send_status   = 'MDApproved',
        history             = ${sql.json(history)},
        updated_at          = NOW()
      WHERE id = ${row.id}
    `

    console.log(`  ✅ Fixed: ${row.id} (requester: ${row.name}, ea actor: ${eaActor})`)
    migrated++
  }

  console.log(`\n🎉 Migration complete. ${migrated}/${candidates.length} records fixed and moved to Pending Accounts.`)
  await sql.end()
}

main().catch((err) => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
