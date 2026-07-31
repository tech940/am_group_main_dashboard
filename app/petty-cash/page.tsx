import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

export const dynamic = 'force-dynamic'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { MainLayout } from '@/components/layout/main-layout'
import { PettyCashWorkspace } from '@/components/petty-cash/petty-cash-workspace'

export default async function PettyCashPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Role gate is the default; an explicit Access-Map Deny then revokes it (per-user).
  // Same asymmetry as AM Finance — Deny worked, Allow did not. Now an explicit Access-Map tick
  // admits a role that was never templated, while an explicit Deny still wins.
  const pettyCashAllowed = canAccessPettyCash(appUser.role)
    || await isPermissionExplicitlyAllowed(appUser, 'petty_cash.view')
  if (!pettyCashAllowed || await isPermissionDenied(appUser, 'petty_cash.view')) {
    forbidden()
  }

  return (
    <MainLayout title="Petty Cash" subtitle="Allocations, spends & approvals">
      <PettyCashWorkspace />
    </MainLayout>
  )
}
