import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { MainLayout } from '@/components/layout/main-layout'
import { DelegationTasksPage } from '@/features/delegation-tasks/delegation-tasks-page'

export const metadata = {
  title: 'Delegation Tasks | AM Group',
  description: 'Assign action items to your team and track them to completion.',
}

export default async function DelegationTasksRoute() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const role = String(appUser.role || '').trim().toLowerCase()
  const allowed = ['ea', 'eba', 'md', 'ceo', 'ed', 'developer', 'admin'].includes(role)
  if (!allowed) forbidden()

  const permission = await requirePermission(appUser, 'delegation_tasks.view')
  if (!permission.allowed) forbidden()

  return (
    <MainLayout title="Delegation Tasks" subtitle="Assign and track action items across the team">
      <DelegationTasksPage currentUserRole={appUser.role} currentUserId={appUser.id} currentUserBrand={appUser.brand} />
    </MainLayout>
  )
}
