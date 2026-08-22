import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewMdTargets } from '@/lib/auth/md-targets-access'

/**
 * The single gate for every /api/targets route.
 *
 * One helper rather than an inline check per route, because the petty-cash equivalent exists for a
 * measured reason: there, the page and 15 endpoints drifted apart in BOTH directions — users the
 * page refused were still served by every API, and vice versa. A shared function is the only shape
 * that cannot drift.
 *
 * ⚠️ Deliberately NO `isPermissionExplicitlyAllowed` escape hatch, unlike the petty-cash guard.
 * That helper returns true for any user with an Access-Map grant — which is precisely what this
 * section must not honour. `canViewMdTargets` is a hardcoded constant so the Access Map cannot
 * reach it (see lib/auth/md-targets-access.ts for why a permission key would leak to `admin`
 * and `hr`). Adding the escape hatch here would quietly undo that.
 *
 * The page gate (app/targets/page.tsx) calls the same predicate, so the two agree by construction.
 */
export async function requireMdTargetsApiAccess(): Promise<
  { appUser: AppUser; response?: undefined } | { appUser?: undefined; response: NextResponse }
> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  if (!canViewMdTargets(appUser.role)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { appUser }
}
