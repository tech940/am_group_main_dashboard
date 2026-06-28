import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessPettyCash } from '@/lib/petty-cash/access'
import { getPettyCashCategories } from '@/lib/petty-cash/server'

export async function GET() {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessPettyCash(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json({ categories: await getPettyCashCategories() })
  } catch (error) {
    console.error('GET /api/petty-cash/categories failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
