import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { invalidateCache } from '@/lib/redis/cache-utils'

// Busts the bank/branch option caches so all users immediately see newly added branches.
// Only admin / developer / md / ea roles may trigger this.
export async function POST() {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const allowed = ['developer', 'admin', 'md', 'ea', 'eba', 'ceo'].includes(appUser.role)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await Promise.all([
      invalidateCache('kia:proforma:options:data'),
      invalidateCache('finance:bank-options'),
    ])

    return NextResponse.json({ ok: true, message: 'Bank/branch option caches cleared. All users will now see the latest data.' })
  } catch (error) {
    console.error('Error busting bank-options cache:', error)
    return NextResponse.json({ error: 'Cache invalidation failed' }, { status: 500 })
  }
}
