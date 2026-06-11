import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas } from '@/lib/db/schema'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { buildKiaProformaPdf } from '@/lib/kia-proforma/invoice'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.proforma.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const [row] = await db.select().from(kiaProformas).where(and(eq(kiaProformas.id, id), isNull(kiaProformas.deletedAt))).limit(1)
  if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })
  const isApprover = await canApproveKiaProformaForUser(appUser, profile.approver)
  if (row.loginEmail !== appUser.email && !isApprover) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pdf = buildKiaProformaPdf(row)
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="kia-proforma-${row.id.slice(0, 8)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
