import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewMdTargets } from '@/lib/auth/md-targets-access'
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

  if (!canViewMdTargets(appUser.role)) {
    forbidden()
  }

  return (
    <MainLayout title="Targets" subtitle="Monthly sales & service targets by branch">
      <MdTargetsWorkspace />
    </MainLayout>
  )
}
