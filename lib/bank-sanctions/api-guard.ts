import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewBankSanctions } from '@/lib/auth/bank-sanctions-access'

/**
 * The single gate for every /api/bank-sanctions route.
 *
 * One helper rather than an inline check per route — the petty-cash guard exists because its page
 * and 15 endpoints drifted apart in both directions, and a shared function is the only shape that
 * cannot drift.
 *
 * ⚠️ Deliberately NO isPermissionExplicitlyAllowed escape hatch: an Access-Map grant must not open
 * the group's borrowing position. See lib/auth/bank-sanctions-access.ts for why a permission key
 * would leak to `admin` and `hr`. Do not add the hatch back "for consistency" with petty cash.
 */
export async function requireBankSanctionsApiAccess(): Promise<
  { appUser: AppUser; response?: undefined } | { appUser?: undefined; response: NextResponse }
> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (!canViewBankSanctions(appUser.role)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { appUser }
}
