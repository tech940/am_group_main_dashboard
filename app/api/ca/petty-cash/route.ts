import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCa } from '@/lib/ca/access'
import { isBranchValue } from '@/lib/branches'
import { listCaPettyCashExpenses, listCaPettyCashFunding } from '@/lib/ca/ca-data'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function normalizeBranch(value: string | null): string {
  if (isBranchValue(value)) return value
  return 'all'
}

function normalizeDecision(value: string | null): 'all' | 'approved' | 'rejected' {
  if (value === 'approved' || value === 'rejected') return value
  return 'all'
}

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Same predicate as app/ca/page.tsx — an Access-Map `ca.view` grant must open the DATA too,
  // or the page renders and every request behind it 403s. See lib/ca/access.ts.
  if (!(await canViewCa(appUser))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const search = searchParams.get('search') || null
    const decision = normalizeDecision(searchParams.get('decision'))
    const dataset = searchParams.get('dataset') === 'funding' ? 'funding' : 'expenses'
    const filters = {
      branch: normalizeBranch(searchParams.get('branch')),
      decision,
      from: from && DATE.test(from) ? from : null,
      to: to && DATE.test(to) ? to : null,
      search,
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
