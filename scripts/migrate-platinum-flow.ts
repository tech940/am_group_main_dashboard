import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'
import { brandHasFirstStage } from '../lib/approvals/first-stage-approver'

async function run() {
  console.log('=== PLATINUM APPROVAL FLOW MIGRATION ===\n')

  console.log(`brandHasFirstStage('platinum') = ${brandHasFirstStage('platinum')}`)
  console.log(`brandHasFirstStage('kia') = ${brandHasFirstStage('kia')}`)

  const records = await analyticsExecute<{
    id: number
    request_no: string
    brand: string
    department: string
    vendor_name: string
    amount: number
    vp_approval: string | null
    ea_approval: string | null
    management_approval: string | null
    account_approval: string | null
    payment_status: string | null
    email_send_status: string | null
  }>(sql`
    SELECT id, request_no, brand, department, vendor_name, amount,
           vp_approval, ea_approval, management_approval, account_approval,
           payment_status, email_send_status
    FROM kia_approval_requests
    WHERE LOWER(brand) = 'platinum'
    ORDER BY id ASC
  `)

  console.log(`Found ${records.length} Platinum approval records:\n`)

  for (const r of records) {
    const stage = vendorPaymentActiveStage({
      brand: r.brand,
      department: r.department,
      vpApproval: r.vp_approval,
      eaApproval: r.ea_approval,
      managementApproval: r.management_approval,
      accountApproval: r.account_approval,
      paymentStatus: r.payment_status,
      emailSendStatus: r.email_send_status
    })

    console.log(`ID: ${r.id} | Req: ${r.request_no} | Dept: ${r.department} | Amount: ${r.amount}`)
    console.log(`  vp: "${r.vp_approval}" | ea: "${r.ea_approval}" | md: "${r.management_approval}" | acc: "${r.account_approval}" | send: "${r.email_send_status}"`)
    console.log(`  => Computed Active Stage: ${stage}\n`)
  }

  // Clear vp_approval on all platinum records to prevent any legacy interference
  const updateRes = await analyticsExecute(sql`
    UPDATE kia_approval_requests
    SET vp_approval = NULL
    WHERE LOWER(brand) = 'platinum'
    RETURNING id, request_no
  `)

  console.log(`Updated ${updateRes.length} Platinum records with vp_approval = NULL.`)

  console.log('\n=== MIGRATION COMPLETE ===')
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
