import 'server-only'

import { NextResponse } from 'next/server'
import type { AppUser } from '@/lib/auth/app-user'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { canViewKiaCustomerPii } from '@/lib/kia/pii'
import { requirePermission } from '@/lib/permissions/service'
import type { ReconViewer } from './read'

/**
 * Its own Access Map switch (owner, 2026-09-18), restricted by default: the tab shows customers' DMS
 * payments and cross-system status, which is oversight information. Granted in the role templates to
 * MD, GSM, Sales Manager / Head, Accounts, CXM and CCM; anyone else is ticked in the Access Map.
 */
export const DMS_RECON_PERMISSION = 'kia.dms_reconciliation.view'

/** Every API under /api/brands/kia/dms-reconciliation goes through this — brand, permission, branch. */
export async function requireDmsReconApi(): Promise<{ response: NextResponse } | { appUser: AppUser; viewer: ReconViewer }> {
  const brand = await requireBrandApiAccess('kia')
  if (brand) return { response: brand }
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permission = await requirePermission(appUser, DMS_RECON_PERMISSION)
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }) }
  return {
    appUser,
    viewer: {
      // The whole pinned list — a user entitled to two branches sees both (see allocation-history).
      dealerScope: getUserDealerScope(appUser, 'kia'),
      canViewPii: canViewKiaCustomerPii(appUser.role),
    },
  }
}
