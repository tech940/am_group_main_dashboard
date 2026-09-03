import 'server-only'

import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser, type AppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'

/**
 * Who may read or edit the Vendor Registry.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * Every handler under `app/api/brands/[brand]/vendors/**` shipped with NO authentication of any
 * kind. Anonymously, a caller could:
 *   - GET the whole vendor master — names, GST numbers and BANK ACCOUNT NUMBERS;
 *   - GET a vendor's complete payment history across every brand (full approval rows: amounts,
 *     requester names, bill URLs);
 *   - POST a new vendor, which then appears in the payment form's picker;
 *   - PATCH a vendor — including its bank account number, which is a payment-redirection vector;
 *   - DELETE a vendor.
 *
 * The Registry is an ALIAS of the `kia.approvals` section (SECTION_ROUTES in
 * lib/permissions/registry.ts), so it takes that section's key rather than a new one — the key is
 * still spelled `kia.*` for historical reasons but the section is multi-brand.
 *
 * ⚠️ This answers "may you use the Registry at all". It does NOT scope ROWS. The payments endpoint
 * is deliberately cross-company (one vendor bills several of our entities), so it must additionally
 * run `filterVisibleApprovals` — a correct permission alone still hands over the whole group's
 * ledger.
 */
export type VendorAccess =
  | { denied: NextResponse; appUser?: undefined }
  | { denied?: undefined; appUser: AppUser }

export async function requireVendorAccess(): Promise<VendorAccess> {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const permission = await requirePermission(appUser, 'kia.approvals.view')
  if (!permission.allowed) {
    return { denied: NextResponse.json({ error: permission.reason }, { status: 403 }) }
  }
  return { appUser }
}
