import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { MainLayout } from '@/components/layout/main-layout'
import { CaDashboard } from '@/features/ca/ca-dashboard'

export const metadata = {
  title: 'CA | AM Group',
  description: 'Read-only chartered-accountant view of approved purchase orders and petty cash, branch-wise.',
}

export default async function CaPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const permission = await requirePermission(appUser, 'ca.view')
  if (!permission.allowed) forbidden()

  return (
    <MainLayout title="CA" subtitle="Approved purchase orders & petty cash — branch-wise">
      <CaDashboard />
    </MainLayout>
  )
}
