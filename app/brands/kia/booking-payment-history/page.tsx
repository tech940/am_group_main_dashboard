import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { canViewBookingPaymentHistory } from '@/lib/kia/booking-payment-history-access'
import { KiaBookingPaymentHistoryPage } from '@/features/kia/kia-booking-payment-history-page'

export const metadata = {
  title: 'Booking Payment History | AM Kia',
  description: 'AM Kia booking payment receipts — collections register with summary, analytics and a filterable receipt list.',
}

export default async function KiaBookingPaymentHistoryRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  // Hardcoded role allowlist (NOT a permission) — MD/Developer/Admin + EA + Sales/General Manager
  // only. See lib/kia/booking-payment-history-access.ts for why this is role-based.
  if (!canViewBookingPaymentHistory(access.appUser.role)) forbidden()

  return <KiaBookingPaymentHistoryPage />
}
