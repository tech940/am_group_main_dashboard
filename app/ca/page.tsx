import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isCaViewRole } from '@/lib/permissions/legacy-module-roles'
import { MainLayout } from '@/components/layout/main-layout'
import { CaDashboard } from '@/features/ca/ca-dashboard'

export const metadata = {
  title: 'CA | AM Group',
  description: 'Read-only chartered-accountant view of approved purchase orders and petty cash, branch-wise.',
}

export default async function CaPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  // HARDCODED access: CA is restricted to exactly CA / MD / Developer — not the tier/permission system,
  // so no override or role change can widen it. Mirrored on every /api/ca route.
  if (!isCaViewRole(appUser.role)) forbidden()

  return (
    <MainLayout title="CA" subtitle="Approved purchase orders & petty cash — branch-wise">
      <CaDashboard />
    </MainLayout>
  )
}
