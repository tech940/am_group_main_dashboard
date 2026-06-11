import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessFinanceOrders } from '@/lib/finance-orders/access'
import { FinanceOrdersPageContent } from '@/features/finance-orders/finance-orders-page'

export default async function FinanceOrdersPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  if (!canAccessFinanceOrders(appUser.role)) {
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
