import { NextResponse } from 'next/server'
import { makeToken } from '@/lib/kia-insurance/auth'

export const dynamic = 'force-dynamic'

const ADMIN_USER = 'admin'
const ADMIN_PASS = 'admin123'

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = makeToken()
      const res = NextResponse.json({
        success: true,
        token,
        user: { username: ADMIN_USER, role: 'admin' },
      })
      res.cookies.set('kia_admin_token', token, {
        path: '/kia-insurance-dashboard',
        httpOnly: false,
        maxAge: 86400,
        sameSite: 'lax',
      })
      return res
    }
    return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }
}
