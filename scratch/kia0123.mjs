import 'dotenv/config'
import postgres from 'postgres'
const sqlc = postgres(process.env.DATABASE_URL, { prepare:false, ssl:'require', max:1, idle_timeout:5, connect_timeout:20 })
const [r] = await sqlc`
  select id, request_no, name, email, brand, dealer_name, dealer_code, department, approval_type,
         vendor_name, amount, remarks, management_remarks, vp_approval, hr_approval, ea_approval,
         management_approval, account_approval, payment_status, email_send_status,
         created_at, updated_at, history
  from kia_approval_requests where request_no = 'KIA_0123'`
if (!r) { console.log('NOT FOUND'); } else {
  const { history, ...rest } = r
  console.log('--- row ---'); console.log(JSON.stringify(rest, null, 2))
  console.log('--- history ---')
  for (const h of (history || [])) console.log(JSON.stringify(h))
}
await sqlc.end({timeout:5})
