import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'

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
    console.error('Error in GET /api/auth/user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
