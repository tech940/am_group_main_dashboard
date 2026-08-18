import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isPermissionDenied, isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { canAccessPettyCash } from './access'

/**
 * The single gate for every petty-cash API route.
 *
 * ⚠️ Why this exists: the PAGE (app/petty-cash/page.tsx) admitted `role OR an explicit Access-Map
 * grant`, minus an explicit Deny — but every API route checked the ROLE ONLY. The two disagreed in
 * both directions:
 *
 *   - A user explicitly DENIED petty cash was blocked from the page while all 15 endpoints kept
 *     serving them. Measured on live data: 4 active users (3 managers + 1 accounts) were in exactly
 *     this state, so revoking their access in the Access Map revoked nothing they could not still
 *     fetch directly.
 *   - A user explicitly GRANTED petty cash whose role was never templated would load the page and
 *     then see every request 403 — the section would simply look broken. Nobody is in that state
 *     today, but it is the same asymmetry and the same fix.
 *
 * Mirrors the page's rule exactly, so the two can no longer drift. The underlying permission
 * snapshot is Redis-cached and fails open, so this costs a cache read, not a query.
 */
export async function requirePettyCashApiAccess(): Promise<
  { appUser: AppUser; response?: undefined } | { appUser?: undefined; response: NextResponse }
> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const allowed = canAccessPettyCash(appUser.role)
    || await isPermissionExplicitlyAllowed(appUser, 'petty_cash.view')
  if (!allowed || await isPermissionDenied(appUser, 'petty_cash.view')) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { appUser }
}
