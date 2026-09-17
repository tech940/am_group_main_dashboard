import 'server-only'

import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { DEALER_SCOPE_NONE, getUserDealerScope } from '@/lib/auth/dealer-scope'
import { canViewKiaCustomerPii } from '@/lib/kia/pii'
import { canUserAccessPermission } from '@/lib/permissions/service'
import { WALK_IN_BRANCHES } from './constants'

/**
 * The one rule for the SIGNED-IN side of Walk-in Leads (the no-login form has its own: a signed link).
 *
 *   1. signed in + the AM Kia brand door + `kia.walk_in_leads.view`  (requireBrandSectionApiAccess);
 *   2. the action's own key: create (form links), edit (follow-up), delete (remove spam);
 *   3. branch scope: a user pinned to Jammu, Udhampur or Banihal only ever reads that showroom;
 *   4. personal data (mobile, e-mail, address) only for the KIA PII roles — redacted on the server.
 */
export const WALK_IN_KEYS = {
  view: 'kia.walk_in_leads.view',
  create: 'kia.walk_in_leads.create',
  edit: 'kia.walk_in_leads.edit',
  delete: 'kia.walk_in_leads.delete',
} as const

export type WalkInAction = keyof typeof WALK_IN_KEYS

export type WalkInViewer = {
  appUser: AppUser
  /** Branch codes this person may read, or null for every branch. */
  scope: string[] | null
  canViewPii: boolean
  can: { create: boolean; edit: boolean; delete: boolean }
}

export async function requireWalkInApi(action: WalkInAction = 'view'): Promise<{ viewer: WalkInViewer } | { denied: NextResponse }> {
  const denied = await requireBrandSectionApiAccess('kia', WALK_IN_KEYS.view)
  if (denied) return { denied }
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const [create, edit, remove] = await Promise.all([
    canUserAccessPermission(appUser, WALK_IN_KEYS.create),
    canUserAccessPermission(appUser, WALK_IN_KEYS.edit),
    canUserAccessPermission(appUser, WALK_IN_KEYS.delete),
  ])
  const can = { create, edit, delete: remove }
  if (action !== 'view' && !can[action]) {
    return { denied: NextResponse.json({ error: `You cannot ${action === 'create' ? 'share the walk-in form' : action === 'edit' ? 'update walk-in leads' : 'remove walk-in leads'}.` }, { status: 403 }) }
  }
  return {
    viewer: {
      appUser,
      scope: walkInScope(appUser),
      canViewPii: canViewKiaCustomerPii(appUser.role),
      can,
    },
  }
}

/**
 * The showrooms a user may read. getUserDealerScope knows only the DMS dealers, so on its own a user pinned to
 * Banihal (JK502) would resolve to "no branch" and see nothing. A pin on Banihal's code or one of its spellings
 * adds Banihal — it never widens an unpinned user, and a pin that names nothing valid still fails closed.
 */
export function walkInScope(appUser: AppUser): string[] | null {
  const base = getUserDealerScope(appUser, 'kia')
  if (base === null) return null
  const pins = String(appUser.dealers || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean)
  const pinned = WALK_IN_BRANCHES
    .filter((branch) => pins.includes(branch.code.toUpperCase()) || branch.aliases.some((alias) => pins.includes(alias.toUpperCase())))
    .map((branch) => branch.code)
  const scope = [...new Set([...base.filter((code) => code !== DEALER_SCOPE_NONE[0]), ...pinned])]
  return scope.length ? scope : [...DEALER_SCOPE_NONE]
}

export function inScope(viewer: WalkInViewer, dealerCode: string): boolean {
  return !viewer.scope || viewer.scope.includes(dealerCode)
}
