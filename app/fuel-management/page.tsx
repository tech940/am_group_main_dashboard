import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewFuelManagement, type FuelManagementViewPermission } from '@/lib/fuel-management/access'
import { FuelManagementClient } from '@/features/fuel-management/fuel-management-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Fuel Management | AM Group',
  description: 'Fuel approved, demo drive distance, and fuel records that need a look.',
}

/*
 * ⚠️ THIS GUARD IS THE ONLY THING PROTECTING THIS PAGE — there is no middleware.ts in this repo.
 *
 * The rule lives in lib/fuel-management/access.ts and app/api/fuel-management/route.ts calls the same predicate.
 * The page used to restate it while the API checked only for a session, which is how the two came apart.
 *
 * scripts/verify-guard-parity.ts proves a section is guarded by finding its view key in page CODE (comments are
 * stripped), so the key is named below as well. It is typed against the predicate's own constant: renaming the key
 * in access.ts without updating this line fails the type check rather than leaving the verifier checking a stale key.
 */
const GUARDED_BY: FuelManagementViewPermission = 'fuel_management.view'

export default async function FuelManagementPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  if (!(await canViewFuelManagement(appUser))) {
    console.info(`[fuel-management] ${GUARDED_BY} refused for user ${appUser.id} (role ${appUser.role})`)
    forbidden()
  }

  // The screen reads everything it shows from /api/fuel-management, so nothing about the user is sent down here.
  return <FuelManagementClient />
}
