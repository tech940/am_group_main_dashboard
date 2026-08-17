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
  'allocation-history': 'allocation-history',
  'payment-window-requests': 'payment-window-requests',
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
  //
  // Allocation History is the exception: it is an AUDIT view naming who allocated each vehicle and
  // why it was pulled back, so it keeps its own narrower kia.allocation_history.view key rather than
  // riding on kia.proforma.view (which is broadly granted, and would hand it to every sales exec).
  //
  // Extra Time Requests is the same kind of exception: it is the MD's approval queue and exposes
  // OTHER customers' booking details as decision context, so it carries its own restricted-by-default
  // kia.payment_window_requests.view key.
  const permissionKey = resolved === 'pending-approval'
    ? 'kia.proforma.approve'
    : resolved === 'allocation-history'
      ? 'kia.allocation_history.view'
      : resolved === 'payment-window-requests'
        ? 'kia.payment_window_requests.view'
        : 'kia.proforma.view'
  const permission = await requirePermission(access.appUser, permissionKey)
  if (!permission.allowed) forbidden()

  if (resolved === 'bookings' && (access.appUser.role === 'manager' || access.appUser.role === 'general_manager')) {
    redirect('/brands/kia/proforma/pending-approval')
  }

  // Resolved once here and passed down so the nav tab and this route guard share one answer — a tab
  // that renders for someone the guard then forbids is the desync we are avoiding.
  const allocationHistory = resolved === 'allocation-history'
    ? permission
    : await requirePermission(access.appUser, 'kia.allocation_history.view')
  const paymentWindow = resolved === 'payment-window-requests'
    ? permission
    : await requirePermission(access.appUser, 'kia.payment_window_requests.view')

  return (
    <KiaProformaPage
      section={resolved}
      canViewAllocationHistory={allocationHistory.allowed}
      canViewPaymentWindowRequests={paymentWindow.allowed}
    />
  )
}
