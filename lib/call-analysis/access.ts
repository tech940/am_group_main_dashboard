import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { canViewCallAnalysis } from '@/lib/callyzer/access'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'

/**
 * The one access rule for every /api/call-analysis/** route — the SAME rule as the page
 * (app/call-analysis/page.tsx): one of the section's roles, OR an explicit Access-Map grant of
 * `call_analysis.view` to that person.
 *
 * ⚠️ Before 2026-09-18 every route checked the role list only, so someone granted the section one person at a
 * time could open the page and then got 403 from every data call on it — an empty page that reads as
 * "broken". Page and API must never disagree again; scripts/verify-call-ai.ts checks every route uses this.
 */
export async function requireCallAnalysisApi(): Promise<{ appUser: AppUser } | { denied: NextResponse }> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (canViewCallAnalysis(appUser.role) || (await isPermissionExplicitlyAllowed(appUser, 'call_analysis.view'))) {
    return { appUser }
  }
  return { denied: NextResponse.json({ error: 'You do not have access to Call Analysis.' }, { status: 403 }) }
}

/** Running the AI pipeline (re-analyse, switch it off, see its costs) is for the MD and developers only. */
export function isCallAiAdmin(role?: string | null): boolean {
  return ['md', 'developer'].includes(String(role || '').trim().toLowerCase())
}
