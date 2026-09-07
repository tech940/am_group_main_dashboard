import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsExecute } from '../lib/analytics/db'
import { isApprovalVisibleTo, filterVisibleApprovals, applyApprovalBrandDefault } from '../lib/kia/approval-scope'
import type { AppUser } from '../lib/auth/app-user'

type U = {
  id: string
  full_name: string
  email: string
  role: string
  brand: string | null
  dealers: string | null
  department: string | null
  is_active: boolean
}

type R = {
  id: string
  request_no: string
  brand: string | null
  dealer_code: string | null
  location: string | null
  department: string | null
  approval_type: string | null
  amount: string
  status: string | null
  payment_status: string | null
  vp_approval: string | null
  management_approval: string | null
  account_approval: string | null
}

async function main() {
  const users = await analyticsExecute<U>(sql`
    SELECT id::text, full_name, email, role::text AS role, brand, dealers, department, is_active
    FROM public.users
    WHERE LOWER(role::text) LIKE '%account%' OR LOWER(role::text) LIKE '%finance%'
    ORDER BY role, full_name
  `)

  console.log(`Found ${users.length} accounts/finance users:\n`)

  const rows = await analyticsExecute<R>(sql`
    SELECT id, request_no, brand, dealer_code, location, department, approval_type, amount::text,
           email_send_status as status, payment_status, vp_approval, ea_approval, management_approval, account_approval
    FROM kia_approval_requests
    ORDER BY created_at DESC
  `)

  console.log(`Total approval requests in DB: ${rows.length}\n`)

  for (const u of users) {
    if (!u.is_active) continue
    const appUser: AppUser = {
      id: u.id,
      supabaseId: u.id,
      email: u.email,
      fullName: u.full_name,
      role: u.role as AppUser['role'],
      brand: u.brand,
      dealers: u.dealers,
      department: u.department,
      isActive: true,
    }

    const visibleRows = filterVisibleApprovals(appUser, rows as any)
    const defaultedRows = applyApprovalBrandDefault(appUser, visibleRows)

    const pendingAccounts = visibleRows.filter(r => r.management_approval === 'APPROVED' && r.account_approval !== 'APPROVED' && r.payment_status !== 'PAID')
    const pendingBeforeMd = visibleRows.filter(r => r.management_approval !== 'APPROVED')
    const paid = visibleRows.filter(r => r.payment_status === 'PAID' || r.account_approval === 'APPROVED')

    console.log(`User: ${u.full_name} (${u.email})`)
    console.log(`  Role: "${u.role}" | Brand: "${u.brand}" | Dealers: "${u.dealers}"`)
    console.log(`  Visible total (filterVisibleApprovals): ${visibleRows.length}`)
    console.log(`  - Pending Accounts Approval (MD Approved): ${pendingAccounts.length}`)
    console.log(`  - In Flight before MD (Stage 1 / HR / EA): ${pendingBeforeMd.length}`)
    console.log(`  - Paid / Completed: ${paid.length}`)
    if (visibleRows.length > 0 && pendingAccounts.length === 0) {
      console.log(`  [NOTE] This user has 0 items waiting for Accounts approval; the default 'Pending My Approval' tab will show 0 items unless they switch to 'All Active Requests' or 'Paid Cases'.`)
    }
    console.log('---')
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
