import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { deletePettyCashRequest } from '@/lib/petty-cash/server'

export async function DELETE(_request: NextRequest, context: RouteContext<'/api/petty-cash/requests/[id]'>) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    const result = await deletePettyCashRequest(appUser, id)
    return NextResponse.json(result)
  } catch (error) {
    console.error('DELETE /api/petty-cash/requests/[id] failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
