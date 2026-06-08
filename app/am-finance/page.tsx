import { forbidden, redirect } from 'next/navigation'
import { canAccessAmFinance, getAmFinancePermissions } from '@/lib/am-finance/access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { AmFinancePageContent } from '@/features/am-finance/am-finance-page'

export default async function AmFinancePage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  if (!canAccessAmFinance(appUser.role)) {
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
