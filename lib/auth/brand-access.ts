import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess, isBranchValue, type BranchValue } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { requirePermission } from '@/lib/permissions/service'
import { enforceDealerScope } from '@/lib/auth/dealer-scope'

export function canAccessBrand(appUser: AppUser | null, brand: BranchValue) {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role) || hasGlobalAccessRole(appUser.role)) return true
  if (hasAllBranchAccess(appUser.brand)) return true
  if (appUser.brand && appUser.brand.includes(',')) {
    return appUser.brand.split(',').map(b => b.trim()).includes(brand)
  }
  return appUser.brand === brand
}

export async function getBrandAccess(brand: string) {
  const appUser = await getAuthenticatedAppUser()
  const normalizedBrand = isBranchValue(brand) ? brand : null

  return {
    appUser,
    brand: normalizedBrand,
    allowed: Boolean(normalizedBrand && canAccessBrand(appUser, normalizedBrand)),
  }
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
