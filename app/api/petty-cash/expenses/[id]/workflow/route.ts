import { NextRequest, NextResponse } from 'next/server'
import { applyPettyCashExpenseWorkflow } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export async function POST(request: NextRequest, context: RouteContext<'/api/petty-cash/expenses/[id]/workflow'>) {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response
    const appUser = gate.appUser

    const { id } = await context.params
    const body = await request.json()
    const result = await applyPettyCashExpenseWorkflow(appUser, { ...body, id })
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/petty-cash/expenses/[id]/workflow failed:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('Forbidden') ? 403 : message.includes('not found') ? 404 : message.includes('awaiting') || message.includes('exceeds') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
