import { forbidden, redirect } from 'next/navigation'
import { KiaProformaPage } from '@/features/kia/kia-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Kia Proforma | AM Kia',
  description: 'Kia proforma generation, approval, finance remarks, and analytics',
}

export default async function Page() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()
  const permission = await requirePermission(access.appUser, 'kia.bookings.view')
  if (!permission.allowed) forbidden()

  if (access.appUser.role === 'manager') {
    redirect('/brands/kia/proforma/pending-approval')
  }

  return <KiaProformaPage section="bookings" />
}
