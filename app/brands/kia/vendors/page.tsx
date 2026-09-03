import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canUserAccessPermission } from '@/lib/permissions/service'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { KiaVendorsClient } from '@/features/kia/kia-vendors-page'

export const metadata = {
  title: 'Vendor Registry | AM KIA',
  description: 'Manage vendors for KIA vendor payment requests',
}

/**
 * ⚠️ This page had NO guard. Line 10 read `// Gated by kia.approvals.view permission` — a COMMENT,
 * and the only thing in the file that mentioned the key. Any authenticated user could open the
 * Vendor Registry and read every vendor's GST number and bank account.
 *
 * Identical to the hole just closed on app/brands/kia/payment-approvals/page.tsx, and it survived
 * for the same reason: verify-guard-parity searches ALL page files as one blob for `'<key>.view'`,
 * so once ANY page mentions the key the check passes for every other page sharing it. The vendors
 * route is an alias of `kia.approvals` (lib/permissions/registry.ts, SECTION_ROUTES), so the
 * approvals page's guard was satisfying the test on this page's behalf.
 */
export default async function KiaVendorsPage() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) redirect('/auth/login')

  const allowed = await canUserAccessPermission(appUser, 'kia.approvals.view')
    || await isPermissionExplicitlyAllowed(appUser, 'kia.approvals.view')
  if (!allowed) forbidden()

  return <KiaVendorsClient />
}
