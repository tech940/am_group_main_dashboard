import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { DataHealthClient } from './data-health-client'

export const dynamic = 'force-dynamic'

export default async function DataHealthPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Same gate as the API — an operations tool, super admins only, deliberately not registry-backed.
  /*
     * ⚠️ ROLE RULE **OR** AN EXPLICIT ACCESS-MAP GRANT (owner decision 2026-09-16: "nothing
     * should be fixed by role"). `isPermissionExplicitlyAllowed` reads hand-ticked overrides
     * only — never role templates — and the key is in GRANT_ONLY_SECTIONS, so no default can
     * set it. This widens access by exactly one person and one section, and it keeps the page
     * agreeing with the sidebar: the link only appears when this returns true.
     */
  if (!isSuperAdminRole(appUser.role)
    && !(await isPermissionExplicitlyAllowed(appUser, 'data_health.view'))) redirect('/dashboard')
  return <DataHealthClient />
}
