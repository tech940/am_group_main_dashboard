import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getAdminCapabilities } from '@/lib/admin/authorization'
import { EffectiveAccessClient } from './effective-access-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Effective Access | AM Group Dashboard',
  description: 'Why a user can or cannot see each section',
}

export default async function EffectiveAccessPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Same capability test the rest of the admin console uses — no separate allowlist to drift.
  if (!getAdminCapabilities(appUser)) redirect('/dashboard')
  return <EffectiveAccessClient />
}
