import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { MainLayout } from '@/components/layout/main-layout'
import { CaDashboard } from '@/features/ca/ca-dashboard'
import { canViewCa } from '@/lib/ca/access'

export const metadata = {
  title: 'CA | AM Group',
  description: 'Read-only chartered-accountant view of approved purchase orders and petty cash, branch-wise.',
}

export default async function CaPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  // HARDCODED access: CA is restricted to exactly CA / MD / Developer — not the tier/permission
  // system, so no override or role change can widen it. The one exception is an explicit Access-Map
  // grant. SHARED with every /api/ca route (lib/ca/access.ts) — they used to state the rule
  // separately and had already drifted: this line honoured the grant and the routes did not.
  if (!(await canViewCa(appUser))) forbidden()

  return (
    <MainLayout title="CA" subtitle="Approved purchase orders & petty cash — branch-wise">
      <CaDashboard />
    </MainLayout>
  )
}
