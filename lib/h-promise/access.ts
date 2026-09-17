import 'server-only'

import { NextResponse } from 'next/server'
import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'
import {
  HP_AREAS,
  deriveCapabilities,
  noCapabilities,
  type HPromiseCapabilities,
  type HpArea,
} from './access-shared'
import { HP_BRAND } from './constants'

/**
 * The one rule for who may open or change anything in AM Tata · H Promise.
 *
 * Every page and every route calls this module; nothing in the section checks a permission any other way.
 * That is the lesson of four outages in this repo — a page and its API each stating the rule, then
 * drifting apart (see lib/insurance/access.ts for the most recent).
 *
 * ── The gates, in order ─────────────────────────────────────────────────────────────────────────
 *   1. signed in, and the account is active;
 *   2. the AM Tata brand door (getBrandAccess): Tata staff, all-branch and global roles — or anyone an
 *      admin ticked for a tata.* section, through hasExplicitBrandGrant;
 *   3. the section's own grant-only key, read from ONE permission snapshot.
 *
 * ⚠️ Deliberately NOT requireBrandSectionApiAccess with a request, and NOT enforceDealerScope: Tata has no
 * entry in lib/dealers/registry.ts, so every Tata user pinned to a branch would be refused. The owner
 * chose "everyone with access sees all Tata locations".
 *
 * ⚠️ An unreadable snapshot resolves to NO capabilities (fail closed) — never to "not denied".
 */

export class HPromiseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HPromiseError'
  }
}

export async function resolveHPromiseCapabilities(appUser: AppUser): Promise<HPromiseCapabilities> {
  const user = { id: appUser.id, name: appUser.fullName || appUser.email }
  if (!appUser.isActive) return noCapabilities(user)
  if (isSuperAdminRole(appUser.role)) return deriveCapabilities(user, {}, true)
  try {
    const snapshot = await getUserPermissionSnapshot(appUser.id)
    return deriveCapabilities(user, snapshot.effective ?? {}, false)
  } catch (error) {
    console.error('[h-promise] permission snapshot unreadable; refusing access:', error)
    return noCapabilities(user)
  }
}

type AreaViewKey = (typeof HP_AREAS)[number]['viewKey']

/**
 * Page guard. `viewKey` is passed as a string LITERAL by each page, so scripts/verify-guard-parity.ts can
 * see which key the page enforces.
 */
export async function requireHPromisePage(viewKey: AreaViewKey | string): Promise<{
  appUser: AppUser
  caps: HPromiseCapabilities
}> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const brand = await getBrandAccess(HP_BRAND)
  if (!brand.allowed) forbidden()

  const caps = await resolveHPromiseCapabilities(appUser)
  const area = HP_AREAS.find((candidate) => candidate.viewKey === viewKey)
  if (!area || !caps[area.id as HpArea].view) forbidden()

  return { appUser, caps }
}

/** For the section's index page: anyone who can open at least one area. */
export async function requireAnyHPromiseArea(): Promise<{ appUser: AppUser; caps: HPromiseCapabilities }> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  const brand = await getBrandAccess(HP_BRAND)
  if (!brand.allowed) forbidden()
  const caps = await resolveHPromiseCapabilities(appUser)
  if (!caps.anyView) forbidden()
  return { appUser, caps }
}

type ApiDenied = { denied: NextResponse; appUser?: undefined; caps?: undefined }
type ApiAllowed = { denied?: undefined; appUser: AppUser; caps: HPromiseCapabilities }

/**
 * Route guard. `check` states what this handler needs, e.g. `(caps) => caps.approvals.approve`.
 * Returns 401 when signed out and 403 otherwise — never a hint about which gate failed.
 */
export async function requireHPromiseApi(check: (caps: HPromiseCapabilities) => boolean): Promise<ApiDenied | ApiAllowed> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return { denied: NextResponse.json({ error: 'Please sign in again.' }, { status: 401 }) }
  }
  const brand = await getBrandAccess(HP_BRAND)
  if (!brand.allowed) {
    return { denied: NextResponse.json({ error: 'You do not have access to H Promise.' }, { status: 403 }) }
  }
  const caps = await resolveHPromiseCapabilities(appUser)
  if (!check(caps)) {
    return { denied: NextResponse.json({ error: 'You do not have access to do that in H Promise.' }, { status: 403 }) }
  }
  return { appUser, caps }
}

/** The actor recorded on every write and every history row. */
export type HPromiseActor = { id: string; name: string; role: string }

export function actorOf(appUser: AppUser): HPromiseActor {
  return { id: appUser.id, name: appUser.fullName || appUser.email, role: String(appUser.role) }
}
