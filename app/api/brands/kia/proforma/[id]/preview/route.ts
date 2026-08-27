import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas } from '@/lib/db/schema'
import { canApproveKiaProformaForUser } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'
import { buildKiaProformaPdf } from '@/lib/kia-proforma/invoice'
import { kiaApprovalStage, pendingStageOf, kiaStageActorLabel } from '@/lib/kia-proforma/approval'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await ensureKiaUserProfile(appUser)
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const [row] = await db.select().from(kiaProformas).where(and(eq(kiaProformas.id, id), isNull(kiaProformas.deletedAt))).limit(1)
  if (!row) return NextResponse.json({ error: 'Proforma not found' }, { status: 404 })

  const isOwner = row.loginEmail && row.loginEmail.toLowerCase() === appUser.email.toLowerCase()
  const isApprover = await canApproveKiaProformaForUser(appUser, profile.approver)

  const proformaPermission = await requirePermission(appUser, 'kia.proforma.view')
  const bookingsPermission = await requirePermission(appUser, 'kia.bookings.view')

  const allowedToView = proformaPermission.allowed || (bookingsPermission.allowed && isOwner)
  if (!allowedToView) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions to view this proforma' }, { status: 403 })
  }

  if (row.loginEmail !== appUser.email && !isApprover && !proformaPermission.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  /*
   * ── AN UNAPPROVED PROFORMA MUST LOOK UNAPPROVED ─────────────────────────────────────────────
   *
   * This route rendered the identical document at every stage of the chain. A PENDING proforma came
   * out byte-for-byte the same as the Finance-signed one the customer is mailed: same "PROFORMA
   * INVOICE" heading, same numbers, no marking of any kind. The Bookings screen links straight here
   * from a control commented "Direct Download Button (Always Visible)", so any consultant handling
   * the customer could pull a finished-looking invoice before the Sales Manager had seen it, let
   * alone Finance, and forward it.
   *
   * ⚠️ The fix is to MARK it, not to block it. The approvers have to read the document in order to
   * approve it — gating this route on approval would break the very chain it is meant to protect.
   * So the PDF stays available to staff at every stage and simply tells the truth about itself.
   *
   * buildKiaProformaPdf already honours documentTitle and disclaimerLines (invoice.ts:457 and
   * 460-466); they were dead code here only because they are not columns on kia_proformas, so they
   * were always undefined. The quote PDF uses the same pattern for its "not valid for bank purpose"
   * box. No rendering code changes.
   */
  const stage = kiaApprovalStage(row.approvalStatus)
  const isFullyApproved = stage === 'approved'
  const awaiting = kiaStageActorLabel(pendingStageOf(row.approvalStatus))

  const pdf = buildKiaProformaPdf(isFullyApproved ? row : {
    ...row,
    documentTitle: stage === 'declined'
      ? 'PROFORMA INVOICE — NOT APPROVED'
      : 'PROFORMA INVOICE — DRAFT, NOT APPROVED',
    disclaimerLines: [
      'NOT APPROVED. Internal review copy — not valid for the customer or for bank purposes.',
      awaiting ? `Awaiting ${awaiting} approval.` : 'This proforma was declined and must be revised.',
      'The approved copy is emailed to the customer by Finance once the chain completes.',
    ],
  })

  // A forwarded file should identify itself from its NAME too, before anyone opens it.
  const filename = isFullyApproved
    ? `kia-proforma-${row.id.slice(0, 8)}.pdf`
    : `kia-proforma-${row.id.slice(0, 8)}-DRAFT-NOT-APPROVED.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
}
