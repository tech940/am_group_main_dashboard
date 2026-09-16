import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess, isBranchValue, type BranchValue } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { requirePermission } from '@/lib/permissions/service'
import { enforceDealerScope } from '@/lib/auth/dealer-scope'
import { hasExplicitBrandGrant } from '@/lib/permissions/deny'

export function canAccessBrand(appUser: AppUser | null, brand: BranchValue) {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role) || hasGlobalAccessRole(appUser.role)) return true
  const userBrand = (appUser.brand || '').trim().toLowerCase()
  if (userBrand === 'all' || hasAllBranchAccess(appUser.brand)) return true
  const targetBrand = String(brand || '').trim().toLowerCase()
  if (userBrand.includes(',')) {
    return userBrand.split(',').map(b => b.trim().toLowerCase()).filter(Boolean).includes(targetBrand)
  }
  return userBrand === targetBrand
}

/**
 * ⚠️ AN ACCESS-MAP GRANT OPENS THE BRAND DOOR.
 *
 * `canAccessBrand` above compares the user's `brand` column against a string and knows nothing about
 * permissions, so before 2026-09-16 a Hyundai user explicitly granted a KIA section in the Access Map
 * passed `requirePermission` and was then thrown out by this gate. The tick was stored, the resolver
 * honoured it, and the door refused it — with nothing on screen to say why.
 *
 * A DEFAULT (which brand you belong to) must not overrule a DECISION (this person may see this).
 *
 * ⚠️ This opens the BRAND, not the section: every page and route behind it keeps its own
 * `requirePermission('<brand>.<section>.view')`, so somebody granted one KIA section still cannot
 * reach the rest of KIA. `hasExplicitBrandGrant` reads only hand-ticked overrides, never role
 * templates, and fails closed.
 *
 * ⚠️ The permission lookup runs ONLY when the plain brand check has already failed, so the common
 * path — a KIA user opening a KIA page — costs exactly what it did before.
 */
export async function getBrandAccess(brand: string) {
  const appUser = await getAuthenticatedAppUser()
  const normalizedBrand = isBranchValue(brand) ? brand : null
  if (!normalizedBrand) return { appUser, brand: null, allowed: false }

  if (canAccessBrand(appUser, normalizedBrand)) {
    return { appUser, brand: normalizedBrand, allowed: true }
  }

  const granted = await hasExplicitBrandGrant(appUser, normalizedBrand)
  return { appUser, brand: normalizedBrand, allowed: granted }
}

export async function requireBrandApiAccess(brand: string) {
  const access = await getBrandAccess(brand)

  if (!access.appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

/**
 * Like requireBrandApiAccess, but ALSO enforces a fine-grained section permission so a
 * per-section Deny (or a restricted role's narrower defaults) is honored server-side — not
 * just hidden in the sidebar. Same return contract: a NextResponse to return on failure, or
 * null when access is granted. Global roles pass the permission check by design.
 */
export async function requireBrandSectionApiAccess(brand: string, permissionKey: string, request?: Request) {
  const access = await getBrandAccess(brand)

  if (!access.appUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const permission = await requirePermission(access.appUser, permissionKey)
  if (!permission.allowed) {
    return NextResponse.json({ error: permission.reason }, { status: 403 })
  }

  // When a request is supplied, enforce per-user dealer/branch scope on its dealer_code param.
  if (request) {
    const dealerDenied = enforceDealerScope(access.appUser, brand, request)
    if (dealerDenied) return dealerDenied
  }

  return null
}
