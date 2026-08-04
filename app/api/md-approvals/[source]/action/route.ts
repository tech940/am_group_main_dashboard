import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isSuperAdminRole } from '@/lib/auth/roles'
import { isMdApprovalSourceId, type MdApprovalSourceId } from '@/lib/md-approvals/sources'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Approve / reject / hold from the MD Approvals screen.
 *
 * ⚠️ THIS ROUTE NEVER WRITES TO AN APPROVAL TABLE. It re-issues the request to the endpoint the
 * source module already owns, forwarding the caller's own cookies so that endpoint authenticates
 * and authorises the real user. Its chain rules, validation, audit trail and state transitions stay
 * the single implementation.
 *
 * Why an internal HTTP call rather than importing a function: for purchase orders and vendor
 * payments the approval logic lives INSIDE the route handler, not in an exported helper. Calling
 * over HTTP is the only way to reuse it exactly; importing would mean copying it, which is precisely
 * the drift this feature exists to avoid. Petty cash does export a helper, but it goes through the
 * same path so all three behave identically and one failure shape reaches the UI.
 *
 * Every source returns the same per-row outcome array, so the client has one result format:
 *   { ok, processed, failed, results: [{ id, ok, error? }] }
 */

type Action = 'approve' | 'reject' | 'hold'

type RowResult = { id: string; ok: boolean; error?: string }

function origin(request: Request) {
  return new URL(request.url).origin
}

/** Re-issue as the same user: forward cookies so the target route's own auth applies. */
async function callModule(
  request: Request,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const response = await fetch(`${origin(request)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') ?? '',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (response.ok) return { ok: true, status: response.status }
  const payload = await response.json().catch(() => null)
  return {
    ok: false,
    status: response.status,
    // 409 means the item moved on while the MD was looking at it — say so plainly rather than
    // surfacing a generic failure the MD cannot act on.
    error: response.status === 409
      ? 'Already actioned by someone else — refresh to see its current stage.'
      : (payload?.error as string) || `Request failed (${response.status})`,
  }
}

/** Purchase orders: a real bulk endpoint exists, but per-item keeps outcomes attributable. */
async function dispatchPurchaseOrders(request: Request, ids: string[], action: Action, remarks: string) {
  const results: RowResult[] = []
  for (const id of ids) {
    const outcome = await callModule(request, '/api/purchase-orders/workflow', {
      orderId: id,
      stage: 'md_approval',
      // The module's vocabulary is approve/deny/hold, not approve/reject/hold.
      action: action === 'reject' ? 'deny' : action,
      data: { remarks },
    })
    results.push({ id, ok: outcome.ok, error: outcome.error })
  }
  return results
}

/** Petty cash: no bulk endpoint at all, so per-item is the only option. */
async function dispatchPettyCash(request: Request, ids: string[], action: Action, remarks: string) {
  const results: RowResult[] = []
  for (const id of ids) {
    const outcome = await callModule(request, `/api/petty-cash/requests/${id}/workflow`, {
      action,
      stage: 'md_approval',
      remarks,
    })
    results.push({ id, ok: outcome.ok, error: outcome.error })
  }
  return results
}

/**
 * Vendor payments: per-item against the single-action endpoint.
 *
 * ⚠️ The module's bulk endpoint is deliberately NOT used. It returns HTTP 200 even when rows fail,
 * hiding failures in a `failedRows` array, and it re-infers the stage per row rather than taking the
 * one we listed on. Going per-item means every outcome is attributable to an id.
 */
async function dispatchVendorPayments(request: Request, ids: string[], action: Action, remarks: string) {
  const results: RowResult[] = []
  for (const id of ids) {
    const outcome = await callModule(request, `/api/brands/kia/approvals/${id}/action`, {
      // This module shouts its actions.
      action: action === 'reject' ? 'REJECT' : action === 'hold' ? 'HOLD' : 'APPROVE',
      stage: 'md',
      remarks,
    })
    results.push({ id, ok: outcome.ok, error: outcome.error })
  }
  return results
}

const DISPATCH: Record<MdApprovalSourceId, typeof dispatchPurchaseOrders> = {
  purchase_orders: dispatchPurchaseOrders,
  petty_cash: dispatchPettyCash,
  vendor_payments: dispatchVendorPayments,
}

export async function POST(request: Request, { params }: { params: Promise<{ source: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Same gate as the page and the list route. The module endpoints re-check authorisation too —
  // this is the outer door, not the only lock.
  if (!isSuperAdminRole(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { source: sourceId } = await params
  if (!isMdApprovalSourceId(sourceId)) {
    return NextResponse.json({ error: `Unknown approval source '${sourceId}'` }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase() as Action
  if (!['approve', 'reject', 'hold'].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve', 'reject' or 'hold'" }, { status: 400 })
  }

  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.map((v: unknown) => String(v)).filter(Boolean)
    : []
  if (!ids.length) return NextResponse.json({ error: 'No items selected.' }, { status: 400 })

  const remarks = String(body?.remarks || '').trim()
  // A rejection with no reason is unauditable — the source modules accept it, we do not.
  if (action === 'reject' && !remarks) {
    return NextResponse.json({ error: 'A reason is required to reject.' }, { status: 400 })
  }

  try {
    const results = await DISPATCH[sourceId](request, ids, action, remarks)
    const failed = results.filter((r) => !r.ok)
    return NextResponse.json({
      // `ok` reflects whether EVERY item succeeded. A partial batch must never read as success —
      // the client renders `failed` explicitly.
      ok: failed.length === 0,
      processed: results.length - failed.length,
      failed: failed.length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply the action' },
      { status: 500 },
    )
  }
}
