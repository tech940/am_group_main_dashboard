import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessScrapErp } from '@/lib/scrap-erp/access'
import { MainLayout } from '@/components/layout/main-layout'
import { ScrapErpShell } from '@/features/scrap-erp/ScrapErpShell'

export const metadata = {
  title: 'Scrap Management | AM Group',
  description: 'Scrap disposal, dynamic master records, reports & sales analytics.',
}

export default async function ScrapPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  if (!canAccessScrapErp(appUser.role)) forbidden()

  return (
    <MainLayout title="Scrap" subtitle="Scrap disposal, dynamic master records, reports & sales analytics">
      <ScrapErpShell />
    </MainLayout>
  )
}
