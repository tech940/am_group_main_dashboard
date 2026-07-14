import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import {
  getKiaFinanceProcessingDetail,
  addKiaFinanceRemark,
  applyKiaFinanceDelay,
  markKiaFinanceComplete,
  addKiaFinanceBankAttempt,
  resolveKiaFinanceBankAttempt,
} from '@/lib/finance/finance-processing'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ proformaId: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perm = await requirePermission(appUser, 'finance.view')
  if (!perm.allowed) return NextResponse.json({ error: perm.reason || 'Forbidden' }, { status: 403 })
  try {
    const { proformaId } = await context.params
    const detail = await getKiaFinanceProcessingDetail(proformaId, appUser)
    if (!detail) return NextResponse.json({ error: 'Finance record not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    console.error('Finance detail failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load finance record' }, { status: 500 })
  }
}

// All finance mutations (remark / delay / complete / bank) flow through here, discriminated by `action`.
// Every mutation requires finance.approve (the write scope); reads only need finance.view.
export async function POST(request: Request, context: { params: Promise<{ proformaId: string }> }) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perm = await requirePermission(appUser, 'finance.approve')
  if (!perm.allowed) return NextResponse.json({ error: perm.reason || 'Forbidden' }, { status: 403 })
  try {
    const { proformaId } = await context.params
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action ?? '')

    switch (action) {
      case 'remark':
        await addKiaFinanceRemark(proformaId, String(body.remark ?? ''), appUser)
        break
      case 'delay':
        await applyKiaFinanceDelay(proformaId, {
          newDate: String(body.newDate ?? ''),
          reasonCategory: String(body.reasonCategory ?? ''),
          reason: body.reason == null ? null : String(body.reason),
        }, appUser)
        break
      case 'complete':
        await markKiaFinanceComplete(proformaId, appUser)
        break
      case 'bank-add':
        await addKiaFinanceBankAttempt(proformaId, {
          bankName: String(body.bankName ?? ''),
          bankBranch: String(body.bankBranch ?? ''),
        }, appUser)
        break
      case 'bank-resolve':
        await resolveKiaFinanceBankAttempt(proformaId, {
          attemptId: String(body.attemptId ?? ''),
          status: body.status === 'Approved' ? 'Approved' : 'Rejected',
          rejectionReason: body.rejectionReason == null ? null : String(body.rejectionReason),
        }, appUser)
        break
      default:
        return NextResponse.json({ error: `Unknown action: ${action || '(none)'}` }, { status: 400 })
    }

    const detail = await getKiaFinanceProcessingDetail(proformaId, appUser)
    return NextResponse.json({ ok: true, detail })
  } catch (error) {
    console.error('Finance mutation failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Finance action failed' }, { status: 400 })
  }
}
