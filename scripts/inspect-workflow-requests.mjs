import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  try {
    const rows = await sql`
      SELECT id, name, vendor_name, amount, vp_approval, hr_approval, ea_approval, management_approval, account_approval, email_send_status, created_at
      FROM kia_approval_requests
      ORDER BY created_at DESC
    `

    console.log(`Total rows in DB: ${rows.length}`)

    rows.forEach((r, idx) => {
      const amt = Number(r.amount || 0)
      console.log(`[${idx + 1}] ID: ${r.id} | Vendor: "${r.vendor_name}" | Amt: ₹${amt.toLocaleString('en-IN')}`)
      console.log(`     ED: ${r.vp_approval || 'null'} | HR: ${r.hr_approval || 'null'} | EA: ${r.ea_approval || 'null'} | MD: ${r.management_approval || 'null'} | Accounts: ${r.account_approval || 'null'} | SendStatus: ${r.email_send_status}`)
    })
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
