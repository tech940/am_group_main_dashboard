import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { getGroupCockpit } from '@/lib/cockpit/cockpit-data'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'cockpit.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const { searchParams } = new URL(request.url)
    const endDate = searchParams.get('endDate')
    const data = await getGroupCockpit({ endDate: endDate && DATE.test(endDate) ? endDate : null })
    return NextResponse.json(data)
  } catch (error) {
    console.error('Cockpit summary failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load cockpit' }, { status: 500 })
  }
}
