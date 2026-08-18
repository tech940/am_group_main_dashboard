import { NextResponse } from 'next/server'
import { getPettyCashCategories } from '@/lib/petty-cash/server'
import { requirePettyCashApiAccess } from '@/lib/petty-cash/api-guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const gate = await requirePettyCashApiAccess()
    if (gate.response) return gate.response

    return NextResponse.json({ categories: await getPettyCashCategories() })
  } catch (error) {
    console.error('GET /api/petty-cash/categories failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
