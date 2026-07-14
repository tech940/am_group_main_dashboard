import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaFinanceApprovalQueue, getKiaFinanceProcessingList } from '@/lib/finance/finance-processing'

export const dynamic = 'force-dynamic'

export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perm = await requirePermission(appUser, 'finance.view')
  if (!perm.allowed) return NextResponse.json({ error: perm.reason || 'Forbidden' }, { status: 403 })
  try {
    const [approvalQueue, processing] = await Promise.all([
      getKiaFinanceApprovalQueue(),
      getKiaFinanceProcessingList(),
    ])
    return NextResponse.json({ approvalQueue, processing })
  } catch (error) {
    console.error('Finance queue failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load finance queue' }, { status: 500 })
  }
}
