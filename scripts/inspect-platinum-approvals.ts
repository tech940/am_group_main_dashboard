import postgres from 'postgres'
import 'dotenv/config'

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) process.exit(1)

  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    connect_timeout: 30,
    max: 1,
  })

  const records = await sql`
    SELECT id, request_no, brand, department, approval_type, amount,
           vp_approval, ea_approval, management_approval, account_approval,
           payment_status, email_send_status, created_at
    FROM kia_approval_requests
    WHERE LOWER(brand) = 'platinum'
    ORDER BY created_at ASC;
  `
  console.log(`Total Platinum records: ${records.length}`)
  console.table(records.map((r: any) => ({
    request_no: r.request_no,
    amount: r.amount,
    vp_approval: r.vp_approval,
    ea_approval: r.ea_approval,
    management_approval: r.management_approval,
    account_approval: r.account_approval,
    email_send_status: r.email_send_status,
  })))

  await sql.end()
}

main().catch(console.error)
