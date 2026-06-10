import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgProformas } from '@/lib/db/schema'
import { canApproveMgProformaForUser } from '@/lib/mg-proforma/access'
import { ensureMgUserProfile } from '@/lib/mg-proforma/server'
import { buildMgProformaPdf } from '@/lib/mg-proforma/invoice'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('mg')
  if (accessResponse) return accessResponse

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'mg.proforma.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  const profile = await ensureMgUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const [row] = await db.select().from(mgProformas).where(and(eq(mgProformas.id, id), isNull(mgProformas.deletedAt))).limit(1)
  if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })
  const isApprover = await canApproveMgProformaForUser(appUser, profile.approver)
  if (row.loginEmail !== appUser.email && !isApprover) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pdf = buildMgProformaPdf(row)
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="mg-proforma-${row.id.slice(0, 8)}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
