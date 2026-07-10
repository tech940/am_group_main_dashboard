import { forbidden, redirect } from 'next/navigation'
import { KiaProformaPage, type KiaProformaSection } from '@/features/kia/kia-proforma-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Kia Proforma | AM Kia',
  description: 'Kia proforma generation, approval, and finance remarks',
}

const SECTION_MAP: Record<string, KiaProformaSection> = {
  bookings: 'bookings',
  stock: 'stock',
  generate: 'generate',
  'all-proforma-details': 'all',
  'finance-remarks': 'finance-remarks',
  'pending-approval': 'pending-approval',
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const { section } = await params
  const resolved = SECTION_MAP[section]
  if (!resolved) redirect('/brands/kia/proforma/bookings')
  // Every proforma view (incl. the internal "bookings" tab) is gated by kia.proforma.view so the
  // Access Map "Proforma" toggle governs the whole module; only the approval queue needs approve.
  const permissionKey = resolved === 'pending-approval' ? 'kia.proforma.approve' : 'kia.proforma.view'
  const permission = await requirePermission(access.appUser, permissionKey)
  if (!permission.allowed) forbidden()

  if (resolved === 'bookings' && access.appUser.role === 'manager') {
    redirect('/brands/kia/proforma/pending-approval')
  }

  return <KiaProformaPage section={resolved} />
}
