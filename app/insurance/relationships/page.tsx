import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { RelationshipsClient } from './relationships-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Insurance 360 | AM Group Dashboard',
  description: 'The complete insurance relationship behind every insured vehicle',
}

export default async function InsuranceRelationshipsPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Identical gate to /insurance and /insurance/renewals — see the API route for why it is not widened.
  if (!canViewRestrictedAnalytics(appUser.role)) redirect('/dashboard')
  return <RelationshipsClient />
}
