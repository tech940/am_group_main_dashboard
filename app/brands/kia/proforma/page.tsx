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
  // The whole Proforma module is gated by kia.proforma.view so the Access Map "Proforma" toggle
  // actually hides/blocks it (previously used kia.bookings.view, so denying Proforma did nothing).
  const permission = await requirePermission(access.appUser, 'kia.proforma.view')
  if (!permission.allowed) forbidden()

  if (access.appUser.role === 'manager') {
    redirect('/brands/kia/proforma/pending-approval')
  }

  // Same flag the [section] route resolves — without it this landing page would omit the
  // Allocation History tab for everyone, since the prop defaults to false.
  const allocationHistory = await requirePermission(access.appUser, 'kia.allocation_history.view')

  return <KiaProformaPage section="bookings" canViewAllocationHistory={allocationHistory.allowed} />
}
