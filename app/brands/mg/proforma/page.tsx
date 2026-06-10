import { forbidden, redirect } from 'next/navigation'
import { MgProformaPage } from '@/features/mg/mg-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'MG Proforma | AM MG',
  description: 'MG proforma generation, approval, finance remarks, and analytics',
}

export default async function Page() {
  const access = await getBrandAccess('mg')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()
  const permission = await requirePermission(access.appUser, 'mg.proforma.view')
  if (!permission.allowed) forbidden()

  return <MgProformaPage section="generate" />
}
