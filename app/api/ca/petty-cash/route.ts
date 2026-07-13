import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isCaViewRole } from '@/lib/permissions/legacy-module-roles'
import { isBranchValue } from '@/lib/branches'
import { listCaPettyCashExpenses, listCaPettyCashFunding } from '@/lib/ca/ca-data'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function normalizeBranch(value: string | null): string {
  if (isBranchValue(value)) return value
  return 'all'
}

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isCaViewRole(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const dataset = searchParams.get('dataset') === 'funding' ? 'funding' : 'expenses'
    const filters = {
      branch: normalizeBranch(searchParams.get('branch')),
      from: from && DATE.test(from) ? from : null,
      to: to && DATE.test(to) ? to : null,
      page: Number(searchParams.get('page')) || 1,
      pageSize: Number(searchParams.get('pageSize')) || 25,
    }
    const data = dataset === 'funding' ? await listCaPettyCashFunding(filters) : await listCaPettyCashExpenses(filters)
    return NextResponse.json({ dataset, ...data })
  } catch (error) {
    console.error('CA petty cash failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load approved petty cash' }, { status: 500 })
  }
}
