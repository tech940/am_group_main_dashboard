import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { applyPettyCashRequestWorkflow } from '@/lib/petty-cash/server'

export async function POST(request: NextRequest, context: RouteContext<'/api/petty-cash/requests/[id]/workflow'>) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    const body = await request.json()
    const result = await applyPettyCashRequestWorkflow(appUser, { ...body, id })
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/petty-cash/requests/[id]/workflow failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('Forbidden') ? 403 : message.includes('not found') ? 404 : message.includes('awaiting') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
