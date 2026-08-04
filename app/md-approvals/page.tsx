import { redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { MdApprovalsClient } from './md-approvals-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'MD Approvals | AM Group Dashboard',
  description: 'Every request across every module that is waiting on the Managing Director',
}

export default async function MdApprovalsPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')
  // Identical hardcoded gate to both API routes (`app/api/md-approvals/[source]/**`). Deliberately a
  // role check rather than a permission key so this queue can never be granted sideways from the
  // Access Map — it aggregates money movement across three modules. See verify-guard-parity.
  if (!isSuperAdminRole(appUser.role)) redirect('/dashboard')
  return <MdApprovalsClient />
}
