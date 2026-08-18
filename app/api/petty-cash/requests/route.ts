import { NextRequest, NextResponse } from 'next/server'
import { createPettyCashRequest, getPettyCashRequestDetails, listPettyCashRequests } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

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
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const id = request.nextUrl.searchParams.get('id')
    if (id) {
      return NextResponse.json(await getPettyCashRequestDetails(appUser, id))
    }

    return NextResponse.json(await listPettyCashRequests(appUser, getListInput(request)))
  } catch (error) {
    console.error('GET /api/petty-cash/requests failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: message.includes('Forbidden') ? 403 : 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const result = await createPettyCashRequest(appUser, await request.json())
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('POST /api/petty-cash/requests failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('Forbidden') ? 403 : message.includes('Invalid') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
