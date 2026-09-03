import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canViewCa } from '@/lib/ca/access'
import { getCaBranchSummary } from '@/lib/ca/ca-data'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

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
    const data = await getCaBranchSummary({
      from: from && DATE.test(from) ? from : null,
      to: to && DATE.test(to) ? to : null,
    })
    return NextResponse.json(data)
  } catch (error) {
    console.error('CA summary failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load CA summary' }, { status: 500 })
  }
}
