import { forbidden, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { InsuranceClient } from '@/app/insurance/insurance-client'
import type { InsuranceBrandId } from '@/lib/insurance/brands'

/**
 * One dealership's insurance book.
 *
 * ── Why three pages and not one with a brand switch ──────────────────────────────────────────────
 * The cross-brand "Insurance Analysis" section was removed on 2026-09-15 at the owner's instruction.
 * A policy book is a dealership's own customers, and the people who work it — the desk that phones a
 * customer whose cover lapses next week — have no business seeing the other two dealerships' books.
 * So the brand is fixed by the ROUTE, not by a control the viewer can change.
 *
 * ⚠️ TWO gates, both server-side, and neither is optional:
 *   1. `getBrandAccess(brand)` — the user's own brand scope. A Hyundai user cannot open Kia's book by
 *      typing the URL, exactly as with every other /brands/<brand>/ page.
 *   2. `<brand>.insurance.view` — the grantable section permission, which is what lets an insurance
 *      desk be given this one section without being given the rest of the dealership.
 *
 * `canEdit` is resolved HERE and passed down, rather than being decided in the browser: it controls
 * whether the status a caller records is writable, and the API re-checks the same key on every write.
 */
export async function BrandInsurancePage({
  brand,
  searchParams,
}: {
  brand: InsuranceBrandId
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await getBrandAccess(brand)
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  const view = await requirePermission(access.appUser, `${brand}.insurance.view`)
  if (!view.allowed) forbidden()

  const edit = await requirePermission(access.appUser, `${brand}.insurance.edit`)

  const resolved = await searchParams

  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading insurance…</div>}>
      <InsuranceClient
        initialSearchParams={resolved}
        lockedBrand={brand}
        canEdit={edit.allowed}
        currentUserName={access.appUser.fullName || access.appUser.email || 'Unknown'}
      />
    </Suspense>
  )
}
