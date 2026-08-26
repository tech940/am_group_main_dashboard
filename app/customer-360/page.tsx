import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { canViewKiaCustomerPii } from '@/lib/kia/pii'
import { Customer360Page } from '@/features/customer-360/customer-360-page'

export const metadata = {
  title: 'Customer 360 | AM Group',
  description: 'One customer end to end — enquiries, bookings, vehicles, insurance, service, spend and what to do next.',
}

/**
 * CUSTOMER 360 — the section that absorbed KIA "Customer Profile".
 *
 * Top-level and brand-agnostic on purpose:  the retired KIA Customer Profile section was removed entirely and the
 * reader is being widened brand by brand behind this one route rather than forked per brand.
 *
 * ── Access ────────────────────────────────────────────────────────────────────────────────────
 * Deny-by-default: `customer_360` is in SECTION_ROUTES but deliberately NOT in
 * DEFAULT_VISIBLE_SECTIONS, so it resolves to MD + Developer until granted from the Access Map.
 *
 * ⚠️ The literal permission string must appear in this file — scripts/verify-guard-parity.ts fails
 * when a registered section's page does not reference its own key.
 */
export default async function Customer360Route() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const granted = await requirePermission(appUser, 'customer_360.view')
  if (!granted.allowed) forbidden()

  // Presentation only. The API redacts server-side before serialising; this flag just lets the
  // client render a lock hint rather than a row of redaction glyphs.
  return <Customer360Page canViewPii={canViewKiaCustomerPii(appUser.role)} />
}
