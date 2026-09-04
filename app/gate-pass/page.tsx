import { forbidden, redirect } from 'next/navigation'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewGatePass } from '@/lib/gate-pass/access'
import { isPermissionDenied } from '@/lib/permissions/deny'
import { GatePassClient } from '@/features/gate-pass/gate-pass-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Demo Car GatePass | AM Group Dashboard',
  description: 'Demo car gate passes: request, approval, and QR-verified exit and entry logging.',
}

/**
 * ⚠️ THIS GUARD IS THE ONLY THING PROTECTING THIS PAGE. There is no middleware.ts in this repo —
 * route protection is entirely per-page. The Vendor Registry shipped with the comment
 * "Gated by kia.approvals.view permission" and no code at all, and was anonymously readable.
 *
 * The predicate itself lives in lib/gate-pass/access.ts and is shared with every API route, because
 * a page and its routes each restating the rule is how this codebase has produced four separate
 * access outages. The literal 'gate_pass.view' below is kept in the source on purpose: the
 * guard-parity verifier greps for it.
 */
export default async function GatePassPage() {
  const appUser = await getAuthenticatedAppUser()

  if (!appUser) {
    redirect('/auth/login')
  }

  // An explicit Deny in the Access Map revokes access immediately, ahead of any grant.
  if (await isPermissionDenied(appUser, 'gate_pass.view')) {
    forbidden()
  }

  if (!(await canViewGatePass(appUser))) {
    forbidden()
  }

  return (
    <GatePassClient
      currentUser={{
        id: appUser.id,
        role: appUser.role,
        fullName: appUser.fullName,
        email: appUser.email,
        brand: appUser.brand,
        dealers: appUser.dealers,
      }}
    />
  )
}
