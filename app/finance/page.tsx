import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { MainLayout } from '@/components/layout/main-layout'
import { FinanceWorkspace } from '@/features/finance/finance-workspace'

export const metadata = {
  title: 'Finance | AM Group',
  description: 'Vehicle-financing workflow: final proforma approval, financing status, delays, remarks, bank management, and audit trail.',
}

export default async function FinancePage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const permission = await requirePermission(appUser, 'finance.view')
  if (!permission.allowed) forbidden()

  const canApprove = (await requirePermission(appUser, 'finance.approve')).allowed

  return (
    <MainLayout title="Finance" subtitle="Vehicle financing — approvals, processing & bank management">
      <FinanceWorkspace canApprove={canApprove} currentUserRole={appUser.role} />
    </MainLayout>
  )
}
