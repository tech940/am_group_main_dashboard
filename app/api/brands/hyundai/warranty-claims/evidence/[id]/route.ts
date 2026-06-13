import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { hyundaiWarrantyClaimActions, hyundaiWarrantyClaimEvidence } from '@/lib/db/schema'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getWarrantyEvidenceUrl } from '@/lib/hyundai/warranty-storage'

export async function GET(_request: Request, context: RouteContext<'/api/brands/hyundai/warranty-claims/evidence/[id]'>) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const [row] = await db
    .select({
      storagePath: hyundaiWarrantyClaimEvidence.storagePath,
      sourceType: hyundaiWarrantyClaimActions.sourceType,
    })
    .from(hyundaiWarrantyClaimEvidence)
    .innerJoin(hyundaiWarrantyClaimActions, eq(hyundaiWarrantyClaimActions.id, hyundaiWarrantyClaimEvidence.actionId))
    .where(eq(hyundaiWarrantyClaimEvidence.id, id))
    .limit(1)
  if (!row) return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
  const permissionKey = `hyundai.${row.sourceType === 'ytp' ? 'warranty_list' : 'warranty_claim_list'}.view`
  const permission = await requirePermission(appUser, permissionKey)
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  return NextResponse.redirect(await getWarrantyEvidenceUrl(row.storagePath))
}

