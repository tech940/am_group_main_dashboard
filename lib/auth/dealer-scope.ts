import 'server-only'

import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { hasAllBranchAccess } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { getBrandDealers, parseUserDealers } from '@/lib/dealers/registry'

/**
 * The dealer/branch codes a user is restricted to within `brand`, or null when unrestricted
 * (sees every branch). Super Admins, global-access roles, and all-branch users are never
 * restricted. A user pinned to dealers of a DIFFERENT brand is treated as unrestricted for
 * this brand (their brand gate stops them elsewhere).
 */
// A restricted user whose dealer pin resolves to NO valid code for this brand is scoped to this
// impossible code, so every consumer (inArray / IN(...) filters, canAccessDealer, UI selectors) shows
// NOTHING rather than falling through to all-branch access. (Consumers guard on `scope.length`, so an
// empty array would read as "unrestricted" — hence a non-matching sentinel instead of [].)
export const DEALER_SCOPE_NONE = ['__no_dealer__'] as const

export function getUserDealerScope(appUser: AppUser | null, brand: string): string[] | null {
  if (!appUser) return null
  if (isSuperAdminRole(appUser.role) || hasGlobalAccessRole(appUser.role) || hasAllBranchAccess(appUser.brand)) return null
  const scoped = parseUserDealers(brand, appUser.dealers)
  if (scoped.length) return scoped
  // No valid dealer code for this brand. No pin at all → unrestricted within the brand (existing
  // behavior). A pin that resolves to nothing valid → fail CLOSED for single-brand users (a typo'd or
  // stale pin must not silently grant all-branch visibility). Multi-brand users stay lenient: their
  // pin is for one of their other brands, and the brand gate governs access here.
  const hasPin = Boolean(String(appUser.dealers || '').trim())
  if (!hasPin) return null
  const brandCount = String(appUser.brand || '').split(',').map((b) => b.trim()).filter(Boolean).length
  return brandCount > 1 ? null : [...DEALER_SCOPE_NONE]
}

/** True if the user may see data for `dealerCode` within `brand`. */
export function canAccessDealer(appUser: AppUser | null, brand: string, dealerCode: string | null | undefined): boolean {
  const scope = getUserDealerScope(appUser, brand)
  if (!scope) return true
  const requested = String(dealerCode || '').trim().toUpperCase()
  return Boolean(requested) && scope.some((code) => code.toUpperCase() === requested)
}

/**
 * Enforce dealer scope on an incoming request. If the user is pinned to specific branches and
 * the request targets another branch — or asks for "all" by omitting dealer_code — return a
 * 403; otherwise null. The dealer is read from the `dealer_code` query param (how every BE
 * route filters). This is the server-side backstop behind the restricted UI selector.
 */
export function enforceDealerScope(appUser: AppUser | null, brand: string, request: Request): NextResponse | null {
  const scope = getUserDealerScope(appUser, brand)
  if (!scope) return null

  const requested = new URL(request.url).searchParams.get('dealer_code')
  if (canAccessDealer(appUser, brand, requested)) return null

  return NextResponse.json({
    error: 'You are restricted to your assigned branch and cannot view this data.',
    allowedDealers: scope,
  }, { status: 403 })
}

/** The dealer codes to expose in a UI selector for this user (their subset, or all for the brand). */
export function allowedDealerOptions(appUser: AppUser | null, brand: string) {
  const all = getBrandDealers(brand)
  const scope = getUserDealerScope(appUser, brand)
  if (!scope) return all
  return all.filter((dealer) => scope.includes(dealer.code))
}
