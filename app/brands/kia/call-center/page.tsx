import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { KiaCallCenterPage } from '@/features/kia/kia-call-center-page'

export const metadata = {
  title: 'Call Center | AM Kia',
  description: 'AM Kia masked click-to-call — call customers without seeing their number',
}

export default async function KiaCallCenterRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const permission = await requirePermission(access.appUser, 'kia.call_center.view')
  if (!permission.allowed) forbidden()

  return <KiaCallCenterPage />
}
