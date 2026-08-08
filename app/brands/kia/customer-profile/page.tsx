import { forbidden, redirect } from 'next/navigation'
import { getBrandAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { canViewKiaCustomerPii } from '@/lib/kia/pii'
import { KiaCustomerProfilePage } from '@/features/kia/customer-profile-page'

export const metadata = {
  title: 'Customer Profile | AM Kia',
  description: 'One customer end to end — enquiry, booking, insurance, service and complaints, plus the gaps between them.',
}

export default async function KiaCustomerProfileRoute() {
  const access = await getBrandAccess('kia')
  if (!access.appUser) redirect('/auth/login')
  if (!access.allowed) forbidden()

  // Registry-gated, deny-by-default. The section is in SECTION_ROUTES but deliberately NOT in
  // DEFAULT_VISIBLE_SECTIONS, so it resolves to MD + Developer only until granted explicitly
  // from the Access Map. The literal 'kia.customer_profile.view' must appear here — scripts/
  // verify-guard-parity.ts:76-80 fails the build if a registered section's page does not
  // reference its own permission key.
  const permission = await requirePermission(access.appUser, 'kia.customer_profile.view')
  if (!permission.allowed) forbidden()

  // Passed for presentation only. The API redacts server-side before serialising — this flag
  // just lets the client render a lock hint instead of a row of redaction glyphs.
  return <KiaCustomerProfilePage canViewPii={canViewKiaCustomerPii(access.appUser.role)} />
}
