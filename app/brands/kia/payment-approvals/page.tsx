import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canUserAccessPermission } from '@/lib/permissions/service'
import { isPermissionExplicitlyAllowed } from '@/lib/permissions/deny'
import { KiaApprovalsClient } from '@/features/kia/kia-approvals-page'

/**
 * ⚠️ This page had NO guard. The line here read `// Gated by 'kia.approvals.view' permission` — a
 * COMMENT, and the only thing in the file that mentioned the key. Every authenticated user could
 * open /brands/kia/payment-approvals and see vendor names, amounts and bill links for whatever
 * rows their brand and dealer pin let through, whether or not they had the permission the sidebar
 * uses to decide whether to show them the link at all.
 *
 * It survived because scripts/verify-guard-parity.ts proves enforcement with a substring search
 * over app/(**)/page.tsx — and that comment was the substring it found. A guard written as a claim
 * rather than as code passes a test that greps for the claim.
 *
 * The key matches the section's own API gate (`requirePermission(appUser, 'kia.approvals.view')` in
 * app/api/brands/kia/approvals/[id]/remark/route.ts) and the sidebar entry
 * (lib/navigation/sections.ts, id 'kia_approvals'), so the link and the page agree. The explicit
 * Access-Map allow is checked alongside it for the same reason the other sections check it: a
 * hand-granted tick must open the page, or the sidebar shows a link that bounces.
 */
export default async function KiaPaymentApprovalsPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  const allowed = await canUserAccessPermission(appUser, 'kia.approvals.view')
    || await isPermissionExplicitlyAllowed(appUser, 'kia.approvals.view')
  if (!allowed) {
    forbidden()
  }

  return (
    <KiaApprovalsClient
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
      }}
    />
  )
}
