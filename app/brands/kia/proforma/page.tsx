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

  // Same flags the [section] route resolves — without them this landing page would omit the
  // Allocation History and Extra Time Requests tabs for everyone, since both props default to false.
  const [allocationHistory, paymentWindow] = await Promise.all([
    requirePermission(access.appUser, 'kia.allocation_history.view'),
    requirePermission(access.appUser, 'kia.payment_window_requests.view'),
  ])

  return (
    <KiaProformaPage
      section="bookings"
      canViewAllocationHistory={allocationHistory.allowed}
      canViewPaymentWindowRequests={paymentWindow.allowed}
    />
  )
}
