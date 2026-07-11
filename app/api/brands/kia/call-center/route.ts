import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getCallQueue } from '@/lib/kia/call-center'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.call_center.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const url = new URL(request.url)
    const data = await getCallQueue(appUser, { search: url.searchParams.get('search') })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to load KIA call queue:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load call queue' }, { status: 500 })
  }
}
