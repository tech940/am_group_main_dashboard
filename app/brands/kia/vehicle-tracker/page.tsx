import { forbidden, redirect } from 'next/navigation'
import { VehicleTrackerPage } from '@/features/kia/vehicle-tracker-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'

export const metadata = {
  title: 'Vehicle Tracker | AM Kia',
  description: 'Track vehicles leaving and returning with AI-verified camera photos',
}

export default async function Page() {
  const access = await getBrandAccess('kia')

  if (!access.appUser) {
    redirect('/auth/login')
  }

  if (!access.allowed) {
    forbidden()
  }

  const permission = await requirePermission(access.appUser, 'kia.service_appointment.view')
  if (!permission.allowed) {
    forbidden()
  }

  return <VehicleTrackerPage />
}
