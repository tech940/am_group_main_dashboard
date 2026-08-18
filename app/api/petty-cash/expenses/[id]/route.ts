import { NextRequest, NextResponse } from 'next/server'
import { deletePettyCashExpense } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export async function DELETE(_request: NextRequest, context: RouteContext<'/api/petty-cash/expenses/[id]'>) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const { id } = await context.params
    const result = await deletePettyCashExpense(appUser, id)
    return NextResponse.json(result)
  } catch (error) {
    console.error('DELETE /api/petty-cash/expenses/[id] failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
