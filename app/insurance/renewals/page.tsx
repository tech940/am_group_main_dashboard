import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewRestrictedAnalytics } from '@/lib/auth/restricted-analytics'
import { RenewalsClient } from './renewals-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Renewal Pipeline | AM Group Dashboard',
  description: 'Vehicles whose insurance is due for renewal',
}

export default async function RenewalsPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Identical gate to /insurance — see the API route for why this is not widened.
  if (!canViewRestrictedAnalytics(appUser.role)) redirect('/dashboard')
  return <RenewalsClient />
}
