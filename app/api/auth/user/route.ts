import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

function isTransientDatabaseError(error: unknown) {
  const cause = error instanceof Error && 'cause' in error
    ? (error as Error & { cause?: unknown }).cause
    : null
  const code = typeof cause === 'object' && cause && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : ''

  return code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
    || code === 'ENETUNREACH'
    || code === 'EHOSTUNREACH'
    || code === 'CONNECT_TIMEOUT'
}

export async function GET() {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({
      id: appUser.id,
      email: appUser.email,
      fullName: appUser.fullName,
      role: appUser.role,
      brand: appUser.brand,
      department: appUser.department,
      isActive: appUser.isActive,
    })
  } catch (error) {
    if (isTransientDatabaseError(error)) {
      console.warn('Temporary database connectivity issue in GET /api/auth/user')
      return NextResponse.json({ error: 'Authentication profile is temporarily unavailable' }, { status: 503 })
    }

    console.error('Error in GET /api/auth/user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
