import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getFinancePayoutDetail, updateFinancePayout } from '@/lib/finance/payouts'

export const dynamic = 'force-dynamic'

/**
 * One payout record + its immutable edit history.
 *
 * Read/write split mirrors app/api/finance/[proformaId]/route.ts: read = `finance.view`,
 * write = `finance.edit` (payout editing is deliberately its own key, so it can be granted without
 * granting proforma approval authority).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permission = await requirePermission(appUser, 'finance.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  const canEdit = (await requirePermission(appUser, 'finance.edit')).allowed
  const { id } = await params

  try {
    const detail = await getFinancePayoutDetail(appUser, id)
    return NextResponse.json({ ...detail, canEdit }, {
      headers: { 'Cache-Control': 'no-store, private' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the record'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The REAL write gate. The GET's canEdit is only a UI hint — this is what actually protects the
  // ledger, and it re-runs on every save.
  const permission = await requirePermission(appUser, 'finance.edit')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  const { id } = await params

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const result = await updateFinancePayout(appUser, id, body)
    // Return the fresh record so the client renders exactly what was stored (coerced dates/numbers),
    // rather than optimistically trusting what it sent.
    const detail = await getFinancePayoutDetail(appUser, id)
    return NextResponse.json({ ...result, ...detail, canEdit: true }, {
      headers: { 'Cache-Control': 'no-store, private' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
