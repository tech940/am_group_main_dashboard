import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { type InsuranceBrandId } from '@/lib/insurance/brands'

/**
 * The one rule that decides who may read or write a dealership's insurance book.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * On 2026-09-15 the cross-brand "Insurance Analysis" section was split into three brand-owned books,
 * and the PAGES moved to `<brand>.insurance.view` while all eight API routes kept the old
 * `canViewRestrictedAnalytics` role list. That is the exact desync this repo has had four outages
 * over: an insurance desk granted the new permission would watch the page load and every panel
 * answer 403, with nothing on screen explaining why.
 *
 * So the rule is stated ONCE, here, and imported by every route. The page states it too
 * (features/insurance/brand-insurance-page.tsx) and the two must agree — they now test the same
 * permission keys against the same brand scope.
 *
 * ── Three gates, in order, all server-side ───────────────────────────────────────────────────────
 *   1. authenticated at all;
 *   2. the user's BRAND scope — a Hyundai user cannot read Kia's book by editing `?type=`, which is
 *      the whole reason the section was split apart;
 *   3. `<brand>.insurance.<action>` — `view` to read, `edit` to record a call outcome.
 *
 * ⚠️ `edit` is NOT implied by `view`. The desk that telephones a customer about a lapsing policy
 * needs to write; a manager reading the book does not. Keeping them separate is what lets one be
 * granted without the other.
 */

export type InsuranceAction = 'view' | 'edit'

type Denied = { denied: NextResponse; appUser?: undefined }
type Allowed = { denied?: undefined; appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>> }

export async function requireInsuranceAccess(
  brand: InsuranceBrandId,
  action: InsuranceAction = 'view',
): Promise<Denied | Allowed> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) {
    return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const access = await getBrandAccess(brand)
  if (!access.allowed) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const permission = await requirePermission(appUser, `${brand}.insurance.${action}`)
  if (!permission.allowed) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { appUser }
}

/**
 * The same check across several brands at once, for the routes that take a comma-separated list.
 *
 * ⚠️ Returns only the brands the caller may actually see, rather than refusing the whole request when
 * one is not permitted. A user with Kia but not Hyundai asking for both should get their Kia book,
 * not a 403 — and must NOT get Hyundai's rows folded in silently.
 */
export async function filterPermittedInsuranceBrands(
  brands: InsuranceBrandId[],
  action: InsuranceAction = 'view',
): Promise<InsuranceBrandId[]> {
  const permitted: InsuranceBrandId[] = []
  for (const brand of brands) {
    const result = await requireInsuranceAccess(brand, action)
    if (!result.denied) permitted.push(brand)
  }
  return permitted
}
