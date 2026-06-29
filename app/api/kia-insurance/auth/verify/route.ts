import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { token } = await req.json()
  if (!token) return NextResponse.json({ valid: false })
  return NextResponse.json({ valid: true, user: { username: 'User', role: 'viewer' } })
}
