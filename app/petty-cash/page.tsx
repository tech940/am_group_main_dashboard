import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

export const dynamic = 'force-dynamic'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { MainLayout } from '@/components/layout/main-layout'
import { PettyCashWorkspace } from '@/components/petty-cash/petty-cash-workspace'

export default async function PettyCashPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Role gate is the default; an explicit Access-Map Deny then revokes it (per-user).
  if (!canAccessPettyCash(appUser.role) || await isPermissionDenied(appUser, 'petty_cash.view')) {
    forbidden()
  }

  return (
    <MainLayout title="Petty Cash" subtitle="Allocations, spends & approvals">
      <PettyCashWorkspace />
    </MainLayout>
  )
}
