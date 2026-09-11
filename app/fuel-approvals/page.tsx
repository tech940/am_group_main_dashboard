import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'
import { FuelApprovalsClient } from '@/features/fuel-approvals/fuel-approvals-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Fuel Approvals | AM Group Dashboard',
  description: 'Manage vehicle and yard fuel requisition orders with CEO -> Accounts approval workflow',
}

export default async function FuelApprovalsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  /*
   * The rule lives in lib/fuel-approvals/view-access.ts and is shared with the routes that serve this
   * section's data, so the page and its API cannot drift apart again.
   *
   * The explicit-deny check below is repeated only so the literal 'fuel_approvals.view' stays in page
   * source — scripts/verify-guard-parity.ts greps for it after stripping comments (the same reason
   * app/gate-pass/page.tsx keeps its literal). canViewFuelApprovals applies the identical deny itself.
   */
  if (await isPermissionDenied(appUser, 'fuel_approvals.view')) {
    forbidden()
  }

  if (!(await canViewFuelApprovals(appUser))) {
    forbidden()
  }

  return (
    <FuelApprovalsClient
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
      }}
    />
  )
}
