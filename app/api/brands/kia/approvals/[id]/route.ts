import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

/**
 * DELETE a payment approval request. DEVELOPER ONLY.
 *
 * ── Why the gate is `role === 'developer'` and not isSuperAdminRole ───────────────────────────
 * isSuperAdminRole is `developer || md`, and this must NOT include the MD. The MD is the business
 * approver on this very screen — handing the person who approves payments the ability to erase them
 * removes the only independent record that an approval happened. This is a break-glass engineering
 * tool, so it is gated on the engineering role alone. Do not "simplify" this to isSuperAdminRole.
 *
 * ── This is a HARD delete, by explicit product decision ──────────────────────────────────────
 * The row is removed permanently. There is no deleted_at column on this table and no archive: the
 * request, its amount, its uploaded bills' URLs and its entire `history` approval trail are gone,
 * including for an order whose payment_status is already PAID and where money really moved.
 *
 * The alternatives were considered and rejected by the product owner: a soft delete would have meant
 * adding `isNull(deletedAt)` to ten route files (list/route.ts alone touches this table 47 times),
 * where missing one leaves "deleted" orders still showing in an export; an archive table would have
 * preserved the trail. Hard delete was chosen deliberately. Nothing here recovers a wrong deletion —
 * only a database backup does.
 *
 * Safe to delete outright at the schema level: no table carries a foreign key to
 * kia_approval_requests, so this orphans nothing.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Exactly one role. Not a permission key — a permission key is grantable from the Access Map,
    // and this capability must never be handed out by ticking a box.
    if (String(appUser.role || '').trim().toLowerCase() !== 'developer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Request id is required' }, { status: 400 })
    }

    /*
     * Read the row first, purely so the response and the server log can name what was destroyed.
     * Once the DELETE runs there is nothing left to describe.
     */
    const [existing] = await db
      .select({
        id: kiaApprovalRequests.id,
        requestNo: kiaApprovalRequests.requestNo,
        name: kiaApprovalRequests.name,
        amount: kiaApprovalRequests.amount,
        brand: kiaApprovalRequests.brand,
        paymentStatus: kiaApprovalRequests.paymentStatus,
      })
      .from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: 'Payment order not found' }, { status: 404 })
    }

    await db.delete(kiaApprovalRequests).where(eq(kiaApprovalRequests.id, id))

    // The only durable trace of the deletion. Deliberately includes the amount and payment status so
    // the log alone answers "what was removed" without the row.
    console.warn(
      '[approvals] HARD DELETE by developer %s (%s): %s | %s | brand=%s | amount=%s | paymentStatus=%s',
      appUser.email,
      appUser.id,
      existing.requestNo || existing.id,
      existing.name,
      existing.brand || 'kia',
      existing.amount,
      existing.paymentStatus,
    )

    return NextResponse.json({
      deleted: true,
      id: existing.id,
      requestNo: existing.requestNo,
    })
  } catch (error) {
    console.error('DELETE /api/brands/kia/approvals/[id] failed:', error)
    return NextResponse.json({ error: 'Failed to delete payment order' }, { status: 500 })
  }
}
