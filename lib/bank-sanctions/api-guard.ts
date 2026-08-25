import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewBankSanctions } from '@/lib/auth/bank-sanctions-access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

/**
 * The single gate for every /api/bank-sanctions route.
 */
export async function requireBankSanctionsApiAccess(): Promise<
  { appUser: AppUser; response?: undefined } | { appUser?: undefined; response: NextResponse }
> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (!canViewBankSanctions(appUser.role) && !(await isPermissionExplicitlyAllowed(appUser, 'bank_sanctions.view'))) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { appUser }
}
