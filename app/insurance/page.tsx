import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { INSURANCE_BRAND_IDS, type InsuranceBrandId } from '@/lib/insurance/brands'

export const dynamic = 'force-dynamic'

/**
 * `/insurance` no longer exists as a section.
 *
 * The cross-brand "Insurance Analysis" page was removed on 2026-09-15 at the owner's instruction and
 * replaced by one book per dealership: /brands/kia/insurance, /brands/hyundai/insurance and
 * /brands/platinum/insurance. It is registered in no sidebar, no search surface and no Access Map
 * column.
 *
 * ⚠️ This file stays as a REDIRECT rather than being deleted, for one reason: the old path is in
 * people's bookmarks and in sent emails, and a 404 tells them the feature was taken away. The brand
 * page it lands on enforces its own two gates, so this grants nothing — a user who may not open the
 * destination is refused there exactly as if they had typed it.
 *
 * Their own brand is preferred. A user with no brand, or one of the many brands that has no policy
 * feed, lands on Kia and is bounced by that page's brand gate if they may not see it — which is the
 * correct answer, and a better one than guessing.
 */
export default async function InsuranceRedirectPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const own = String(appUser.brand || '').trim().toLowerCase()
  const brand: InsuranceBrandId = (INSURANCE_BRAND_IDS as readonly string[]).includes(own)
    ? (own as InsuranceBrandId)
    : 'kia'

  redirect(`/brands/${brand}/insurance`)
}
