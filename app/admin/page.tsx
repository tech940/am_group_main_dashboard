import { Suspense } from 'react'
import { forbidden, redirect } from 'next/navigation'
import { AdminConsole } from '@/features/admin/admin-console'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'

export default async function AdminPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  if (!isSuperAdminRole(appUser.role)) forbidden()

  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading Admin Console...</div>}>
      <AdminConsole />
    </Suspense>
  )
}
