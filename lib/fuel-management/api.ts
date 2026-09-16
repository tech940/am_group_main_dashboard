import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { canEditFuelManagement, canViewFuelManagement } from './access'

/**
 * The guard every /api/fuel-management route calls first — the SAME predicate app/fuel-management/page.tsx uses,
 * stated once. The route this section replaced checked only for a session, so any employee could read every fuel
 * record the page had just refused; guard/page desync has caused four outages in this codebase.
 *
 * Every refusal is `{ error }` in words for the person on the screen. Driver and database messages are logged
 * where they happen and never sent to the browser.
 */

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

export function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE })
}

export type GuardResult = { ok: true; appUser: AppUser; canEdit: boolean } | { ok: false; response: NextResponse }

export async function guardFuelManagement(options: { needEdit?: boolean } = {}): Promise<GuardResult> {
  let appUser: AppUser | null
  try {
    appUser = await getAuthenticatedAppUser()
  } catch (error) {
    console.error('[fuel-management] could not resolve the signed-in user:', error)
    return { ok: false, response: refuse(500, 'We could not confirm your sign-in just now. Please try again.') }
  }
  if (!appUser) return { ok: false, response: refuse(401, 'Your session has ended. Please sign in again.') }

  try {
    if (!(await canViewFuelManagement(appUser))) {
      return { ok: false, response: refuse(403, "You don't have access to Fuel Management. Ask an administrator if you need it.") }
    }
    const canEdit = await canEditFuelManagement(appUser)
    if (options.needEdit && !canEdit) {
      return { ok: false, response: refuse(403, 'Only people allowed to change fuel settings can do this.') }
    }
    return { ok: true, appUser, canEdit }
  } catch (error) {
    console.error(`[fuel-management] could not resolve access for user ${appUser.id}:`, error)
    return { ok: false, response: refuse(500, 'We could not check your access just now. Please try again.') }
  }
}
