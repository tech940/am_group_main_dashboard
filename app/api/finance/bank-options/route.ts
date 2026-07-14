import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { loadFinanceBankOptions } from '@/lib/finance/finance-processing'

export const dynamic = 'force-dynamic'

export async function GET() {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perm = await requirePermission(appUser, 'finance.view')
  if (!perm.allowed) return NextResponse.json({ error: perm.reason || 'Forbidden' }, { status: 403 })
  try {
    const data = await loadFinanceBankOptions()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Finance bank-options failed:', error)
    return NextResponse.json({ error: 'Failed to load bank options' }, { status: 500 })
  }
}
