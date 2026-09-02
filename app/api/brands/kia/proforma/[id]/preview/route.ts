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
import { proformaContentDisposition } from '@/lib/kia-proforma/pdf-filename'
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

  const stage = kiaApprovalStage(row.approvalStatus)
  const isFullyApproved = stage === 'approved'
  const awaiting = kiaStageActorLabel(pendingStageOf(row.approvalStatus))

  /*
   * ── NO PROFORMA PDF LEAVES THIS ROUTE UNTIL THE CHAIN COMPLETES ─────────────────────────────
   *
   * Reported from the office: consultants were still downloading proformas before Finance had
   * approved them. The Bookings screen already hides the button on an unapproved row — but hiding a
   * button does not close a URL, and this route served the document to anyone who could reach it.
   * A marked draft is still a complete PROFORMA INVOICE with the customer's name and every figure
   * on it, and it forwards to a customer exactly as well as the real one.
   *
   * ⚠️ This REPLACES an earlier decision to mark rather than block. That note argued the approvers
   * need the PDF to review, so blocking would stall the chain it protects. It does not: the
   * approvers read the proforma in the ProformaPreviewDrawer on the Proforma page, which renders
   * the RECORD and never calls this route — checked before changing this, because a gate that
   * stalls its own approval chain is worse than the leak it closes.
   *
   * So the people who can ACT on the pending stage keep access, and everyone else — including the
   * consultant who raised it and is the person most likely to send it on — gets a 403 until Finance
   * signs. The marking below stays as defence in depth for the approvers who do fetch it.
   */
  if (!isFullyApproved && !isApprover) {
    return NextResponse.json({
      error: awaiting
        ? `This proforma is not approved yet — it is awaiting ${awaiting} approval. The PDF becomes available once Finance signs it.`
        : 'This proforma was declined and must be revised before it can be downloaded.',
    }, { status: 403 })
  }

  /*
   * ── AN UNAPPROVED PROFORMA MUST STILL LOOK UNAPPROVED ───────────────────────────────────────
   * Reached only by an approver now, but the marking is kept: a reviewer who saves a copy must not
   * end up holding a document indistinguishable from the Finance-signed one.
   *
   * buildKiaProformaPdf already honours documentTitle and disclaimerLines (invoice.ts:457 and
   * 460-466); they were dead code here only because they are not columns on kia_proformas.
   */

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

  /*
   * Named after the CUSTOMER, not the row id — "Govind Dabi.pdf" rather than
   * "kia-proforma-22e3fe5e.pdf". A folder of proformas is otherwise unsearchable.
   *
   * Set here as well as on the link's `download` attribute because the two win in different
   * situations: the attribute for a same-origin click, this header when the URL is opened directly.
   * Both call the same helper so they cannot disagree.
   *
   * A forwarded draft still identifies itself from its NAME, before anyone opens it.
   */
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': proformaContentDisposition(
        'inline',
        row.customerName,
        row.id,
        isFullyApproved ? '' : ' - DRAFT NOT APPROVED',
      ),
      'cache-control': 'private, no-store',
    },
  })
}
