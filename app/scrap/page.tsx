import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { MainLayout } from '@/components/layout/main-layout'
import { ScrapErpShell } from '@/features/scrap-erp/ScrapErpShell'

export const metadata = {
  title: 'Scrap Management | AM Group',
  description: 'Scrap disposal, dynamic master records, reports & sales analytics.',
}

export default async function ScrapPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // The helper's SECOND argument is the whole point: the sidebar and the search registry already
  // pass the permission map, so dropping it here is what produced "link appears, page forbids".
  // An explicit Access-Map tick now opens the page, exactly as it opens the link.
  if (!canAccessScrapErp(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'scrap_erp.view'))) forbidden()

  return (
    <MainLayout title="Scrap" subtitle="Scrap disposal, dynamic master records, reports & sales analytics">
      <ScrapErpShell />
    </MainLayout>
  )
}
