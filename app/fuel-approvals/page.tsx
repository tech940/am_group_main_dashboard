import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isPermissionDenied, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'
import { FuelApprovalsClient } from '@/features/fuel-approvals/fuel-approvals-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Fuel Approvals | AM Group Dashboard',
  description: 'Manage vehicle and yard fuel requisition orders with ED -> HR -> MD approval workflow',
}

export default async function FuelApprovalsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Admin Access Map override: explicit Deny in Access Map revokes access immediately
  if (await isPermissionDenied(appUser, 'fuel_approvals.view')) {
    forbidden()
  }

  // Check if allowed via role permissions snapshot, explicit allow override, or leadership role
  const snapshot = await getUserPermissionSnapshot(appUser.id)
  const isAllowed =
    snapshot.effective['fuel_approvals.view'] === true ||
    (await isPermissionExplicitlyAllowed(appUser, 'fuel_approvals.view')) ||
    ['developer', 'admin', 'md', 'ceo', 'ed', 'hr'].includes(appUser.role.trim().toLowerCase())

  if (!isAllowed) {
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
