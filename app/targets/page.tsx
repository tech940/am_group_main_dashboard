import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewMdTargets } from '@/lib/auth/md-targets-access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { MainLayout } from '@/components/layout/main-layout'
import { MdTargetsWorkspace } from '@/features/targets/md-targets-page'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Targets | AM Group Dashboard',
  description: 'Monthly sales and service targets by branch, and achievement against them.',
}

/**
 * MD-only. Gated on the hardcoded role constant, NOT on a permission key.
 *
 * A `targets.view` key left out of DEFAULT_VISIBLE_SECTIONS would still reach `admin` and `hr` —
 * both are `family: 'super'` in lib/permissions/tiers.ts, and the super tier bundle sets every key
 * true without consulting RESTRICTED_DEFAULT_PERMISSION_KEYS. See lib/auth/md-targets-access.ts.
 *
 * The sidebar (components/layout/sidebar.tsx), the search guard (lib/navigation/sections.ts) and
 * every /api/targets route call the SAME predicate, so none of them can drift from this page.
 */
export default async function TargetsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  /*
     * ⚠️ ROLE RULE **OR** AN EXPLICIT ACCESS-MAP GRANT (owner decision 2026-09-16: "nothing
     * should be fixed by role"). `isPermissionExplicitlyAllowed` reads hand-ticked overrides
     * only — never role templates — and the key is in GRANT_ONLY_SECTIONS, so no default can
     * set it. This widens access by exactly one person and one section, and it keeps the page
     * agreeing with the sidebar: the link only appears when this returns true.
     */
  if (!canViewMdTargets(appUser.role)
    && !(await isPermissionExplicitlyAllowed(appUser, 'targets.view'))) {
    forbidden()
  }

  return (
    <MainLayout title="Targets" subtitle="Monthly sales & service targets by branch">
      <MdTargetsWorkspace />
    </MainLayout>
  )
}
