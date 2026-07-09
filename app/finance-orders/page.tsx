import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessFinanceOrders } from '@/lib/finance-orders/access'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { FinanceOrdersPageContent } from '@/features/finance-orders/finance-orders-page'

export default async function FinanceOrdersPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // Role gate is the default; an explicit Access-Map Deny then revokes it (per-user).
  if (!canAccessFinanceOrders(appUser.role) || await isPermissionDenied(appUser, 'finance_orders.view')) {
    forbidden()
  }

  return (
    <FinanceOrdersPageContent
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
      }}
    />
  )
}
