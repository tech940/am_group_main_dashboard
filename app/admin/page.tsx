import { Suspense } from 'react'
import { forbidden, redirect } from 'next/navigation'
import { AdminConsole } from '@/features/admin/admin-console'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

export default async function AdminPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  /*
   * ⚠️ GRANTING `admin_panel.view` GRANTS THE WHOLE CONSOLE — Users, Access Map, Roles, Audit,
   * Settings. Whoever holds it can change permissions, INCLUDING THEIR OWN, so it is the one key
   * that can be used to obtain every other key. Raised with the owner and opened at their explicit
   * instruction ("nothing should be fixed by role"). It is grant-only: no role template, tier
   * bundle or blanket sets it, so it is off for everyone until an admin ticks it by hand.
   */
  if (!isSuperAdminRole(appUser.role)
    && !(await isPermissionExplicitlyAllowed(appUser, 'admin_panel.view'))) forbidden()

  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading Admin Console...</div>}>
      <AdminConsole />
    </Suspense>
  )
}
