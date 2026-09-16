import { forbidden, redirect } from 'next/navigation'
import { VehicleTrackerPage } from '@/features/kia/vehicle-tracker-page'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { canFillVehicleTracker, canViewVehicleTracker } from '@/lib/kia/vehicle-tracker-access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

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

  // Role-gated: Branch Admin + Service GM can view; only Branch Admin (+ MD/Developer) can fill.
  // ⚠️ Role rule OR an explicit Access-Map grant — owner decision 2026-09-16.
  if (!canViewVehicleTracker(access.appUser.role)
    && !(await isPermissionExplicitlyAllowed(access.appUser, 'kia.vehicle_tracker.view'))) {
    forbidden()
  }

  return <VehicleTrackerPage canFill={canFillVehicleTracker(access.appUser.role)} />
}
