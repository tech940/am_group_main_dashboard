import { forbidden, redirect } from 'next/navigation'
import { KiaBookingsClient } from './kia-bookings-client'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Bookings CRM | AM Kia',
  description: 'AM Kia booking, proforma, stock allocation, finance, and delivery CRM workspace',
}

export default async function KiaBookingsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()
  const permission = await requirePermission(access.appUser, 'kia.bookings.view')
  if (!permission.allowed) forbidden()

  if (access.appUser.role === 'manager') {
    redirect('/brands/kia/proforma/pending-approval')
  }

  const resolvedSearchParams = await searchParams
  return <KiaBookingsClient initialSearchParams={resolvedSearchParams} currentUserRole={access.appUser.role} />
}
