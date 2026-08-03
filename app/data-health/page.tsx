import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { DataHealthClient } from './data-health-client'

export const dynamic = 'force-dynamic'

export default async function DataHealthPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Same gate as the API — an operations tool, super admins only, deliberately not registry-backed.
  if (!isSuperAdminRole(appUser.role)) redirect('/dashboard')
  return <DataHealthClient />
}
