import { NextResponse } from 'next/server'
import { validateToken } from '@/lib/kia-insurance/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { token } = await req.json()
  if (!token) return NextResponse.json({ valid: false })
  const result = validateToken(token)
  if (!result.valid) return NextResponse.json({ valid: false })
  return NextResponse.json({ valid: true, user: result.user })
}
