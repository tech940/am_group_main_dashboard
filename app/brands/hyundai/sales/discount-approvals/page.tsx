import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { DiscountApprovalsDashboardClient } from './discount-approvals-client'

export default async function DiscountApprovalsDashboardPage() {
  const access = await getBrandAccess('hyundai')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'hyundai.sales.discount_approvals.view')
  if (!permission.allowed) {
    forbidden()
  }

  return (
    <DiscountApprovalsDashboardClient
      currentUser={{
        id: access.appUser.id,
        role: access.appUser.role,
        fullName: access.appUser.fullName,
        email: access.appUser.email,
        brand: access.appUser.brand,
      }}
      branch="hyundai"
    />
  )
}
