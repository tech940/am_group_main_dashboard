import { forbidden, redirect } from 'next/navigation'
import { MgProformaPage, type MgProformaSection } from '@/features/mg/mg-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'MG Proforma | AM MG',
  description: 'MG proforma generation, approval, finance remarks, and analytics',
}

const SECTION_MAP: Record<string, MgProformaSection> = {
  generate: 'generate',
  'all-proforma-details': 'all',
  'finance-remarks': 'finance-remarks',
  'pending-approval': 'pending-approval',
  'hyp-ins-analytics': 'analytics',
  'business-insights': 'insights',
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const access = await getBrandAccess('mg')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const { section } = await params
  const resolved = SECTION_MAP[section]
  if (!resolved) redirect('/brands/mg/proforma/generate')
  const permissionKey = resolved === 'pending-approval'
      ? 'mg.proforma.approve'
      : 'mg.proforma.view'
  const permission = await requirePermission(access.appUser, permissionKey)
  if (!permission.allowed) forbidden()

  return <MgProformaPage section={resolved} />
}
