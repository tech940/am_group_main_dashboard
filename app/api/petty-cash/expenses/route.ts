import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { createPettyCashExpense, getPettyCashExpenseDetails, listPettyCashExpenses } from '@/lib/petty-cash/server'

function getListInput(request: NextRequest) {
  const params = request.nextUrl.searchParams
  return {
    page: params.get('page') || undefined,
    pageSize: params.get('pageSize') || undefined,
    status: params.get('status'),
    branchId: params.get('branchId'),
    search: params.get('search'),
    startDate: params.get('startDate'),
    endDate: params.get('endDate'),
  }
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const id = request.nextUrl.searchParams.get('id')
    if (id) {
      return NextResponse.json(await getPettyCashExpenseDetails(appUser, id))
    }

    return NextResponse.json(await listPettyCashExpenses(appUser, getListInput(request)))
  } catch (error) {
    console.error('GET /api/petty-cash/expenses failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await createPettyCashExpense(appUser, await request.json())
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('POST /api/petty-cash/expenses failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('Forbidden') ? 403 : message.includes('No active') ? 409 : message.includes('exceeds') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
