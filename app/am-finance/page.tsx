import { forbidden, redirect } from 'next/navigation'
import { canAccessAmFinance, getAmFinancePermissions } from '@/lib/am-finance/access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { AmFinancePageContent } from '@/features/am-finance/am-finance-page'

export default async function AmFinancePage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Role gate is the default; an explicit Access-Map Deny then revokes it (per-user).
  // Was allow-blind: an explicit Deny could CLOSE the section but an explicit Allow could never
  // OPEN it, so ticking am_finance for an out-of-list role did nothing. Now symmetric.
  const amFinanceAllowed = canAccessAmFinance(appUser.role)
    || await isPermissionExplicitlyAllowed(appUser, 'am_finance.view')
  if (!amFinanceAllowed || await isPermissionDenied(appUser, 'am_finance.view')) {
    forbidden()
  }

  return (
    <AmFinancePageContent
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
      }}
      permissions={getAmFinancePermissions(appUser.role)}
    />
  )
}
