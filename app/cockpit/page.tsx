import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { MainLayout } from '@/components/layout/main-layout'
import { CockpitDashboard } from '@/features/cockpit/cockpit-dashboard'

export const metadata = {
  title: 'Group Cockpit | AM Group',
  description: 'Executive cross-brand cockpit: group service revenue, approved cash, and KIA sales & stock, month-to-date.',
}

export default async function CockpitPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const permission = await requirePermission(appUser, 'cockpit.view')
  if (!permission.allowed) forbidden()

  return (
    <MainLayout title="Group Cockpit" subtitle="Cross-brand executive overview — month to date">
      <CockpitDashboard />
    </MainLayout>
  )
}
