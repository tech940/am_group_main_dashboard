import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'

function isMissingPermissionTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('permission_groups')
    || message.includes('user_permissions')
    || message.includes('permission_audit_logs')
    || message.includes('permissions_group_key')
}

export async function GET() {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const snapshot = await getUserPermissionSnapshot(appUser.id)
    return NextResponse.json({
      permissions: snapshot.effective,
      overrides: snapshot.overrides,
    })
  } catch (error) {
    if (isMissingPermissionTableError(error)) {
      return NextResponse.json({
        permissions: null,
        setupRequired: true,
      })
    }

    console.error('Error in GET /api/auth/permissions:', error)
    return NextResponse.json({ error: 'Failed to load permissions' }, { status: 500 })
  }
}
