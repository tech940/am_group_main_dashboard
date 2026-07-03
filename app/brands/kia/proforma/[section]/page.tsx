import { forbidden, redirect } from 'next/navigation'
import { KiaProformaPage, type KiaProformaSection } from '@/features/kia/kia-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Kia Proforma | AM Kia',
  description: 'Kia proforma generation, approval, finance remarks, and analytics',
}

const SECTION_MAP: Record<string, KiaProformaSection> = {
  bookings: 'bookings',
  generate: 'generate',
  'all-proforma-details': 'all',
  'finance-remarks': 'finance-remarks',
  'pending-approval': 'pending-approval',
  'hyp-ins-analytics': 'analytics',
  'business-insights': 'insights',
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const { section } = await params
  const resolved = SECTION_MAP[section]
  if (!resolved) redirect('/brands/kia/proforma/bookings')
  const permissionKey = resolved === 'bookings'
      ? 'kia.bookings.view'
      : resolved === 'pending-approval'
      ? 'kia.proforma.approve'
      : 'kia.proforma.view'
  const permission = await requirePermission(access.appUser, permissionKey)
  if (!permission.allowed) forbidden()

  return <KiaProformaPage section={resolved} />
}
