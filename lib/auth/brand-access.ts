import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess, isBranchValue, type BranchValue } from '@/lib/branches'
import { isSuperAdminRole } from '@/lib/auth/roles'

export function canAccessBrand(appUser: AppUser | null, brand: BranchValue) {
  if (!appUser) return false
  if (isSuperAdminRole(appUser.role)) return true
  if (hasAllBranchAccess(appUser.brand)) return true
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
