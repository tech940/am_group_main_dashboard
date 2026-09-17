import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { KiaWalkInLeadsPage } from '@/features/kia/walk-in-leads/walk-in-leads-page'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Walk-in Leads | AM Kia',
  description: 'AM Kia showroom walk-ins captured from the no-login form.',
}

export default async function KiaWalkInLeadsRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.walk_in_leads.view')
  if (!permission.allowed) forbidden()

  return <KiaWalkInLeadsPage />
}
